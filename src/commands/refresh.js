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

    // Defer the reply to avoid timeout (3 second limit)
    await interaction.deferReply({ ephemeral: true });

    try {      
      const { embed, date } = await fetchCancelledLectures();      // Get the current date in Amsterdam timezone
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

              // Always try to update the message with latest data
              await message.edit({ embeds: [embed] });
              await interaction.editReply({
                content: "The cancelled lectures embed has been updated.",
              });
            } catch (fetchError) {
              // Message was deleted or doesn't exist anymore
              console.log(`Message not found or deleted: ${fetchError.message}`);
              const message = await interaction.channel.send({
                embeds: [embed],
              });
              setLastMessageId(interaction.channel.id, message.id);
              await interaction.editReply({
                content: "The cancelled lectures embed has been sent (previous message was deleted).",
              });
            }
          } else {
            // No previous message found, send a new one
            const message = await interaction.channel.send({
              embeds: [embed],
            });
            setLastMessageId(interaction.channel.id, message.id);
            await interaction.editReply({
              content: "The cancelled lectures embed has been sent.",
            });
          }
        } else {
          await interaction.editReply({
            content: "This command can only be used in the designated channel.",
          });
        }
      } else {
        await interaction.editReply({
          content: "Failed to fetch the latest cancelled lectures.",
        });
      }
    } catch (error) {
      console.error("Error executing refresh command:", error);
      await interaction.editReply({
        content: "An error occurred while refreshing the cancelled lectures.",
      });
    }
  },
};
