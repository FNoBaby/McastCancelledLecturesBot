const { SlashCommandBuilder } = require("@discordjs/builders");
const {
  fetchCancelledLectures,
} = require("../functions/fetchCancelledLectures");
const config = require("../../config.json");
const {
  getChannelState,
  setLastMessageId,
} = require("../functions/sharedState");
const moment = require("moment-timezone");
const Discord = require("discord.js");

const cooldowns = new Map();
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

    await interaction.deferReply({ ephemeral: true });

    try {
      const { embed, date, lectures = [] } = await fetchCancelledLectures();
      const todayDateKey = getTodayDateKey();
      const parsedDateKey = getDateKey(date);
      const hasLectures =
        parsedDateKey === todayDateKey &&
        Array.isArray(lectures) &&
        lectures.length > 0;

      if (embed) {
        if (config.channelIds.includes(interaction.channel.id)) {
          const state = getChannelState(interaction.channel.id);
          const now = new Date().toLocaleString("en-US", {
            timeZone: AMSTERDAM_TZ,
            dateStyle: "full",
            timeStyle: "short",
          });
          embed.setFooter({ text: `Last Refreshed: ${now}` });
          const embedToUse = hasLectures
            ? embed
            : createStatusEmbed(
                "**Lectures not published yet. Use /refresh to check again.**"
              );
          const canEditToday =
            state &&
            state.messageId &&
            state.dateKey &&
            state.dateKey === todayDateKey;

          if (canEditToday) {
            try {
              const message = await interaction.channel.messages.fetch(state.messageId);
              await message.edit({ embeds: [embedToUse] });
              await interaction.editReply({
                content: "The cancelled lectures embed has been updated.",
              });
            } catch (fetchError) {
              console.log(fetchError);
              const message = await interaction.channel.send({
                embeds: [embedToUse],
              });
              setLastMessageId(interaction.channel.id, message.id, todayDateKey);
              await interaction.editReply({
                content: "The cancelled lectures embed has been sent.",
              });
            }
          } else {
            const message = await interaction.channel.send({
              embeds: [embedToUse],
            });
            setLastMessageId(interaction.channel.id, message.id, todayDateKey);
            console.log(
              'Successfully refreshed in server "',
              interaction.guild.name,
              '"in channel"',
              interaction.channel.name,
              '"'
            );
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
