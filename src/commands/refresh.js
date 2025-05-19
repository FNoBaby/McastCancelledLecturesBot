const { SlashCommandBuilder } = require("@discordjs/builders");
const {
  fetchCancelledLectures,
} = require("../functions/fetchCancelledLectures");
const config = require("../../config.json");
const {
  getLastMessageId,
  setLastMessageId,
} = require("../functions/sharedState");
const moment = require("moment-timezone");
const Discord = require("discord.js");

const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("Refresh and resend the latest cancelled lectures embed"),
  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();
    const cooldownAmount = 10 * 1000; // 10 seconds in milliseconds

    if (userId !== config.devId) {
      if (cooldowns.has(userId)) {
        const expirationTime = cooldowns.get(userId) + cooldownAmount;
        if (now < expirationTime) {
          const timeLeft = (expirationTime - now) / 1000;
          return interaction.reply({
            content: `Please wait ${timeLeft.toFixed(
              1
            )} more seconds before reusing the \`/refresh\` command.`,
            ephemeral: true,
          });
        }
      }

      cooldowns.set(userId, now);
      setTimeout(() => cooldowns.delete(userId), cooldownAmount);
    }

    try {      const { embed, date } = await fetchCancelledLectures();      // Get the current date in Amsterdam timezone
      const currentDateInAmsterdam = moment.tz("Europe/Amsterdam").startOf("day");
      
      // Convert the parsed date to Amsterdam timezone for comparison
      const dateObject = date instanceof Date ? date : new Date();
      const parsedDateInAmsterdam = moment(dateObject).tz("Europe/Amsterdam").startOf("day");

      if (embed) {
        if (config.channelIds.includes(interaction.channel.id)) {
          const lastMessageId = getLastMessageId(interaction.channel.id);
          const now = new Date().toLocaleString("en-US", {
            timeZone: "Europe/Amsterdam",
            dateStyle: "full",
            timeStyle: "short",
          });
          embed.setFooter({ text: `Last Refreshed: ${now}` });

          if (lastMessageId) {
            try {
              const message = await interaction.channel.messages.fetch(
                lastMessageId
              );

              if (!currentDateInAmsterdam.isSame(parsedDateInAmsterdam, 'day')) {
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

                await message.edit({ embeds: [noNewLecturesEmbed] });
                await interaction.reply({
                  content: "The cancelled lectures embed has been updated.",
                  ephemeral: true,
                });
                return;
              }

              await message.edit({ embeds: [embed] });
              await interaction.reply({
                content: "The cancelled lectures embed has been updated.",
                ephemeral: true,
              });
            } catch (fetchError) {
              console.log(fetchError);
              const message = await interaction.reply({
                embeds: [embed],
                fetchReply: true,
              });
              setLastMessageId(interaction.channel.id, message.id);
              await interaction.followUp({
                content: "The cancelled lectures embed has been sent.",
                ephemeral: true,
              });
            }
          } else {
            let message = null;
            if (!(currentDate.getTime() === parsedDate.getTime())) {
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

              message = await interaction.reply({
                embeds: [noNewLecturesEmbed],
                fetchReply: true,
              });
            } else {
              message = await interaction.reply({
                embeds: [embed],
                fetchReply: true,
              });
            }

            setLastMessageId(interaction.channel.id, message.id);
            console.log(
              'Successfully refreshed in server "',
              interaction.guild.name,
              '"in channel"',
              interaction.channel.name,
              '"'
            );
            await interaction.followUp({
              content: "The cancelled lectures embed has been sent.",
              ephemeral: true,
            });
          }
        } else {
          await interaction.reply({
            content: "This command can only be used in the designated channel.",
            ephemeral: true,
          });
        }
      } else {
        await interaction.reply({
          content: "Failed to fetch the latest cancelled lectures.",
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error("Error executing refresh command:", error);
      await interaction.reply({
        content: "An error occurred while refreshing the cancelled lectures.",
        ephemeral: true,
      });
    }
  },
};
