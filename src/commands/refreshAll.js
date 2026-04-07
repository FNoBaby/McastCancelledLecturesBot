const { SlashCommandBuilder } = require("@discordjs/builders");
const { fetchCancelledLectures } = require("../functions/fetchCancelledLectures");
const config = require("../../config.json");
const { getChannelState, setLastMessageId } = require("../functions/sharedState");
const moment = require("moment-timezone");
const Discord = require("discord.js");

const AMSTERDAM_TZ = "Europe/Amsterdam";

function getTodayDateKey() {
  return moment.tz(AMSTERDAM_TZ).format("YYYY-MM-DD");
}

function getDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return moment(date).tz(AMSTERDAM_TZ).format("YYYY-MM-DD");
}

function createStatusEmbed(description) {
  return new Discord.EmbedBuilder()
    .setTitle("Cancelled Lectures")
    .setDescription(description)
    .setColor("Random")
    .setFooter({
      text: `Last Checked: ${new Date().toLocaleString("en-GB", {
        timeZone: AMSTERDAM_TZ,
        dateStyle: "full",
        timeStyle: "short",
      })}`,
    });
}

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

      const { embed, date, lectures = [] } = await fetchCancelledLectures();
      if (!embed) {
        return interaction.editReply({
          content: "Failed to fetch the latest cancelled lectures.",
        });
      }

      const todayDateKey = getTodayDateKey();
      const parsedDateKey = getDateKey(date);
      const hasLectures =
        parsedDateKey === todayDateKey &&
        Array.isArray(lectures) &&
        lectures.length > 0;

      const now = new Date().toLocaleString("en-US", {
        timeZone: AMSTERDAM_TZ,
        dateStyle: "full",
        timeStyle: "short",
      });
      embed.setFooter({ text: `Last Refreshed: ${now}` });

      const noNewLecturesEmbed = createStatusEmbed(
        "**Lectures not published yet. Use /refresh to check again.**"
      );

      let successCount = 0;
      let failCount = 0;

      for (const channelId of config.channelIds) {
        try {
          const channel = await interaction.client.channels.fetch(channelId);
          const guild = channel.guild;
          console.log(`Refreshing embed in server: "${guild.name}", channel: "${channel.name}"`);

          const state = getChannelState(channelId);
          const useEmbed = hasLectures ? embed : noNewLecturesEmbed;
          const canEditToday =
            state &&
            state.messageId &&
            state.dateKey &&
            state.dateKey === todayDateKey;

          if (canEditToday) {
            try {
              const message = await channel.messages.fetch(state.messageId);
              await message.edit({ embeds: [useEmbed] });
            } catch (fetchError) {
              console.log(`Last message not found in ${channel.name}, sending new one`);
              const message = await channel.send({ embeds: [useEmbed] });
              setLastMessageId(channelId, message.id, todayDateKey);
            }
          } else {
            const message = await channel.send({ embeds: [useEmbed] });
            setLastMessageId(channelId, message.id, todayDateKey);
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