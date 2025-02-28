// Suppress warnings
process.emitWarning = () => {};

const Discord = require("discord.js");
const cron = require("node-cron");
const config = require("./config.json");
const {
  fetchCancelledLectures,
  resetCancelledLecturesArray 
} = require("./src/functions/fetchCancelledLectures");
const refreshCommand = require("./src/commands/refresh");
const refreshAllCommand = require("./src/commands/refreshAll");
const {
  setLastMessageId,
  getLastMessageId,
} = require("./src/functions/sharedState");
const moment = require("moment-timezone");

const client = new Discord.Client({
  intents: [
    Discord.IntentsBitField.Flags.Guilds,
    Discord.IntentsBitField.Flags.GuildMessages,
    Discord.IntentsBitField.Flags.MessageContent,
  ],
});

client.login(config.token);

const rest = new Discord.REST().setToken(config.token);

client.on("ready", async () => {
  console.log("Bot is ready");

  // Set bot's presence
  client.user.setPresence({
    activities: [
      { name: "for Cancelled Lectures", type: Discord.ActivityType.Watching },
    ],
    status: "online",
  });

  try {
    console.log("Re-registering commands...");

    // Fetch and delete existing global commands
    const globalCommands = await rest.get(
      Discord.Routes.applicationCommands(config.clientId)
    );
    for (const command of globalCommands) {
      await rest.delete(
        `${Discord.Routes.applicationCommands(config.clientId)}/${command.id}`
      );
    }

    // Register new global commands
    const newGlobalCommands = [
      {
        name: "refresh",
        description: "Refresh the Cancelled Lectures list",
      },
    ];

    await rest.put(Discord.Routes.applicationCommands(config.clientId), {
      body: newGlobalCommands,
    });

    if (config.devGuildId) {
      // Fetch and delete existing guild commands
      const guildCommands = await rest.get(
        Discord.Routes.applicationGuildCommands(
          config.clientId,
          config.devGuildId
        )
      );
      for (const command of guildCommands) {
        await rest.delete(
          `${Discord.Routes.applicationGuildCommands(
            config.clientId,
            config.devGuildId
          )}/${command.id}`
        );
      }

      // Register new guild commands
      const newDevCommands = [
        {
          name: "refreshall",
          description: "Refresh the Cancelled Lectures list in all channels",
        },
      ];

      await rest.put(
        Discord.Routes.applicationGuildCommands(
          config.clientId,
          config.devGuildId
        ),
        { body: newDevCommands }
      );
    }

    console.log("Successfully registered application commands.");
  } catch (error) {
    console.error("Error registering application commands:", error);
  }

  //Test Cron Jobs
  // cron.schedule("53-59 8 * * 1-5", async () => {
  //   // Runs every minute from 7:30 AM to 7:59 AM (Mon-Fri)
  //   console.log("Cron job scheduled at 7:30 AM...");
  //   await runCronJob();
  // });

  // Schedule cron jobs
  cron.schedule("00-59 6 * * 1-5", async () => {
    // Runs every minute from 7:30 AM to 7:59 AM (Mon-Fri)
    console.log("Cron job scheduled at 7:30 AM...");
    await runCronJob();
  });

  cron.schedule("0 7 * * 1-5", async () => {
    // Runs exactly at 8:00 AM (Mon-Fri)
    console.log("Cron job scheduled at 8:00 AM...");
    await runCronJob();
  });

  // Reset lecturesFound at 8:00:05 AM every day and send "lectures not yet published" message if no new lectures were found
  cron.schedule("1 7 * * 1-5", async () => {
    if (!lecturesFound) {
      for (const channelId of config.channelIds) {
        const channel = await client.channels.fetch(channelId);
        const noNewLecturesEmbed = new Discord.EmbedBuilder()
          .setTitle("Cancelled Lectures")
          .setDescription(
            "**Lectures not published yet. Use /refresh to check again.**"
          )
          .setColor("Random")
          .setFooter({
            text: `Last Checked: ${new Date().toLocaleString("en-GB", {
              timeZone: "Europe/Amsterdam",
              dateStyle: "full",
              timeStyle: "short",
            })}`,
          });
        await channel.send({ embeds: [noNewLecturesEmbed] });
        setLastMessageId(channelId, message.id);
      }
    }
    lecturesFound = false;
    isCronJobRunning = false;
  });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  if (isCronJobRunning) {
    return interaction.reply({
      content:
        "Commands are disabled during the cron job execution. Please try again later.",
      ephemeral: true,
    });
  }

  const { commandName } = interaction;

  if (commandName === "refresh") {
    console.log(
      `User "${interaction.user.tag}" ran /refresh in server "${interaction.guild.name}" in channel "#${interaction.channel.name}"`
    );
    await refreshCommand.execute(interaction);
  } else if (commandName === "refreshall") {
    if (interaction.user.id !== config.devId) {
      return interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
    }
    console.log(
      `User "${interaction.user.tag}" ran /refreshall in server "${interaction.guild.name}" in channel "#${interaction.channel.name}"`
    );
    await refreshAllCommand.execute(interaction);
  }
});

let isCronJobRunning = false;
let lecturesFound = false;

async function runCronJob() {
  if (lecturesFound) return;
  console.log("Cron job running...");
  isCronJobRunning = true;
  try {
    await resetCancelledLecturesArray();
    const { embed, date } = await fetchCancelledLectures() || {};
    if (!embed || !date) {
      console.error("Failed to fetch the latest cancelled lectures.");
      return;
    }
    const currentDate = moment.tz("Europe/Amsterdam").startOf("day").toDate();
    const parsedDate = moment
      .tz(date, "dddd, MMMM Do YYYY, h:mm:ss a", "Europe/Amsterdam")
      .startOf("day")
      .toDate();

    if (embed && parsedDate.getTime() === currentDate.getTime()) {
      for (const channelId of config.channelIds) {
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
          console.error(`Failed to fetch channel with ID: ${channelId}`);
          continue;
        }
        const lastMessageId = getLastMessageId(channelId);
        if (lastMessageId) {
          const lastMessage = await channel.messages.fetch(lastMessageId);
          if (lastMessage.embeds[0]?.description === embed.description) {
            const noNewLecturesEmbed = new Discord.EmbedBuilder()
              .setTitle("Cancelled Lectures")
              .setDescription(
                "**Lectures not published yet. Use /refresh to check again.**"
              )
              .setColor("Random")
              .setFooter({
                text: `Last Checked: ${new Date().toLocaleString("en-GB", {
                  timeZone: "Europe/Amsterdam",
                  dateStyle: "full",
                  timeStyle: "short",
                })}`,
              });
            await channel.send({ embeds: [noNewLecturesEmbed] });
            setLastMessageId(channelId, message.id);
            continue;
          } else {
            lecturesFound = true;
            isCronJobRunning = false;
            console.log("Lectures found. Sending Lectures....");
            const message = await channel.send({ embeds: [embed] });
            setLastMessageId(channelId, message.id);
          }
        } else {
          console.log("Last Message ID not found. Sending Lectures....");
          lecturesFound = true;
          isCronJobRunning = false;
          const message = await channel.send({ embeds: [embed] });
          setLastMessageId(channelId, message.id);
        }
      }
    } else {
      if (!(parsedDate.getTime() === currentDate.getTime())) {
        console.log("Parsed Date:", parsedDate);
        console.log("Parsed Date:", parsedDate.getTime());
        console.log("Current Date:", currentDate);
        console.log("Current Date:", currentDate.getTime());

        console.log("No new lectures found yet.");
        lecturesFound = false;
      } else if (!embed) {
        console.log("Invalid Embed");
        lecturesFound = false;
      } else {
        console.error("Failed to fetch the latest cancelled lectures.");
      }
    }
  } catch (error) {
    console.error("Error sending scheduled lectures:", error);
  } finally {
    isCronJobRunning = false;
  }
}

// console.log("Testing");
// async function main() {

//   const { embed, date } = await fetchCancelledLectures();
//   const currentDate = moment.tz('Europe/Amsterdam').startOf('day').toDate();
//   const parsedDate = moment(date, 'dddd, MMMM Do YYYY, h:mm:ss a').startOf('day').toDate();

//   console.log("Parsed" ,parsedDate.getTime());
//   console.log("Current", currentDate.getTime());

//   console.log("Equal?" ,parsedDate.getTime() === currentDate.getTime());

// }

// main();
