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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("refreshall")
    .setDescription(
      "Refresh and resend the latest cancelled lectures embed in all channels"
    ),
  async execute(interaction) {
    if (interaction.user.id !== config.devId) {
      return interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    try {
      const { embed, date } = await fetchCancelledLectures();
      const currentDate = moment.tz("Europe/Amsterdam").startOf("day").toDate();
      const parsedDate = moment
        .tz(date, "dddd, MMMM Do YYYY, h:mm:ss a", "Europe/Amsterdam")
        .startOf("day")
        .toDate();
      if (embed) {
        console.log(
          `Successfully refreshed all embeds from server: "${interaction.guild.name}"`
        );
        for (const channelId of config.channelIds) {
          const channel = await interaction.client.channels.fetch(channelId);
          const guild = channel.guild;
          const lastMessageId = getLastMessageId(channelId);
          const now = new Date().toLocaleString("en-US", {
            timeZone: "Europe/Amsterdam",
            dateStyle: "full",
            timeStyle: "short",
          });
          embed.setFooter({ text: `Last Refreshed: ${now}` });
          console.log(
            `Refreshing embed in server: "${guild.name}", channel: "${channel.name}"`
          );
          if (lastMessageId) {
            try {
              const message = await channel.messages.fetch(lastMessageId);

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

                await message.edit({ embeds: [noNewLecturesEmbed] });
                await interaction.reply({
                  content: "The cancelled lectures embed has been updated.",
                  ephemeral: true,
                });
                return;
              }

              await message.edit({ embeds: [embed] });
            } catch (fetchError) {
              const message = await channel.send({ embeds: [embed] });
              setLastMessageId(channelId, message.id);
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
            
            setLastMessageId(channelId, message.id);
          }
        }
        await interaction.reply({
          content:
            "The cancelled lectures embed has been refreshed in all channels.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "Failed to fetch the latest cancelled lectures.",
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error("Error executing refreshall command:", error);
      await interaction.reply({
        content:
          "An error occurred while refreshing the cancelled lectures in all channels.",
        ephemeral: true,
      });
    }
  },
};
