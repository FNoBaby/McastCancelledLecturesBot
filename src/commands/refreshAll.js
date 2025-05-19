const { SlashCommandBuilder } = require("@discordjs/builders");
const { fetchCancelledLectures } = require("../functions/fetchCancelledLectures");
const config = require("../../config.json");
const { getLastMessageId, setLastMessageId } = require("../functions/sharedState");
const moment = require("moment-timezone");
const Discord = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("refreshall")
    .setDescription("Refresh and resend the latest cancelled lectures embed in all channels"),
  async execute(interaction) {
    if (interaction.user.id !== config.devId) {
      return interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    try {
      // Defer the reply since this might take time
      await interaction.deferReply({ ephemeral: true });

      const { embed, date } = await fetchCancelledLectures();
      if (!embed || !date) {
        return interaction.editReply({
          content: "Failed to fetch the latest cancelled lectures.",
        });
      }      const currentDate = moment.tz("Europe/Amsterdam").startOf("day").toDate();
      // Fix date parsing to match the fetchCancelledLectures.js implementation
      const parsedDate = date instanceof Date ? date : new Date(); // Use the Date object returned from fetchCancelledLectures
      const now = new Date().toLocaleString("en-US", {
        timeZone: "Europe/Amsterdam",
        dateStyle: "full",
        timeStyle: "short",
      });
      embed.setFooter({ text: `Last Refreshed: ${now}` });

      const noNewLecturesEmbed = new Discord.EmbedBuilder()
        .setTitle("Cancelled Lectures")
        .setDescription("**Lectures not published yet. Use /refresh to check again.**")
        .setColor("Random")
        .setFooter({
          text: `Last Checked: ${new Date().toLocaleString("en-GB", {
            timeZone: "Europe/Amsterdam",
            dateStyle: "full",
            timeStyle: "short",
          })}`,
        });

      let successCount = 0;
      let failCount = 0;

      for (const channelId of config.channelIds) {
        try {
          const channel = await interaction.client.channels.fetch(channelId);
          const guild = channel.guild;
          console.log(`Refreshing embed in server: "${guild.name}", channel: "${channel.name}"`);

          const lastMessageId = getLastMessageId(channelId);
          const useEmbed = currentDate.getTime() === parsedDate.getTime() ? embed : noNewLecturesEmbed;

          if (lastMessageId) {
            try {
              const message = await channel.messages.fetch(lastMessageId);
              await message.edit({ embeds: [useEmbed] });
            } catch (fetchError) {
              console.log(`Last message not found in ${channel.name}, sending new one`);
              const message = await channel.send({ embeds: [useEmbed] });
              setLastMessageId(channelId, message.id);
            }
          } else {
            const message = await channel.send({ embeds: [useEmbed] });
            setLastMessageId(channelId, message.id);
          }
          successCount++;
        } catch (channelError) {
          console.error(`Failed to refresh channel ${channelId}:`, channelError);
          failCount++;
        }
      }

      console.log(`Successfully refreshed all embeds from server: "${interaction.guild.name}"`);
      await interaction.editReply({
        content: `Refresh complete: ${successCount} channels updated, ${failCount} failed.`,
      });
    } catch (error) {
      console.error("Error executing refreshall command:", error);
      if (interaction.deferred) {
        await interaction.editReply({
          content: "An error occurred while refreshing the cancelled lectures in all channels.",
        });
      } else {
        await interaction.reply({
          content: "An error occurred while refreshing the cancelled lectures in all channels.",
          ephemeral: true,
        });
      }
    }
  },
};