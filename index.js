const Discord = require("discord.js");
const cron = require("node-cron");
const config = require("./config.json");
const fetchCancelledLectures = require("./src/functions/fetchCancelledLectures");
const refreshCommand = require("./src/commands/refresh");
const refreshAllCommand = require("./src/commands/refreshAll");
const {
  setLastMessageId,
  getLastMessageId,
} = require("./src/functions/sharedState");

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
    activities: [{ name: 'Monitoring cancelled lectures', type: Discord.ActivityType.Watching }],
    status: 'online',
  });

  try {
    console.log("Re-registering commands...");

    const globalCommands = [
      {
        name: "refresh",
        description: "Refresh the Cancelled Lectures list",
      },
    ];

    await rest.put(Discord.Routes.applicationCommands(config.clientId), {
      body: globalCommands,
    });

    if (config.devGuildId) {
      const devCommands = [
        {
          name: "refreshall",
          description: "Refresh the Cancelled Lectures list in all channels",
        },
      ];

      await rest.put(
        Discord.Routes.applicationGuildCommands(config.clientId, config.devGuildId),
        { body: devCommands }
      );
    }

    console.log("Successfully registered application commands.");
  } catch (error) {
    console.error("Error registering application commands:", error);
  }

  cron.schedule("30-59 7 * * 1-5", async () => {
    // Runs every minute from 7:30 AM to 7:59 AM (Mon-Fri)
    runCronJob();
  });

  cron.schedule("0 8 * * 1-5", async () => {
    // Runs exactly at 8:00 AM (Mon-Fri)
    runCronJob();
  });

  // Reset lecturesFound at 8:00:05 AM every day and send "lectures not yet published" message if no new lectures were found
  cron.schedule("0 8 * * 1-5", async () => {
    setTimeout(async () => {
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
                    timeZone: "Europe/London",
                    dateStyle: "full",
                    timeStyle: "short",
                  })}`,
                });
              await channel.send({ embeds: [noNewLecturesEmbed] });
            }
          }
          lecturesFound = false;
          isCronJobRunning = false;
    }, 5000);
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
    await refreshCommand.execute(interaction);
  } else if (commandName === "refreshall") {
    if (interaction.user.id !== config.devId) {
      return interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
    }
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
    const embed = await fetchCancelledLectures();
    if (embed) {
      for (const channelId of config.channelIds) {
        const channel = await client.channels.fetch(channelId);
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
                  timeZone: "Europe/London",
                  dateStyle: "full",
                  timeStyle: "short",
                })}`,
              });
            await channel.send({ embeds: [noNewLecturesEmbed] });
            continue;
          } else {
            lecturesFound = true;
            isCronJobRunning = false;
            console.log("Lectures found. Stopping the cron job...");
            return;
          }
        }
        const message = await channel.send({ embeds: [embed] });
        setLastMessageId(channelId, message.id);
      }
    } else {
      console.error("Failed to fetch the latest cancelled lectures.");
    }
  } catch (error) {
    console.error("Error sending scheduled lectures:", error);
  }
}
