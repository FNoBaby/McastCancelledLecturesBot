const { SlashCommandBuilder } = require("@discordjs/builders");
const config = require("../../config.json");
const { findTodaysMessage } = require("../functions/sharedState");
const moment = require("moment-timezone");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Purge today's cancelled lectures messages from all channels (Dev only)"),
  async execute(interaction) {
    // Check if user is the developer
    if (interaction.user.id !== config.devId) {
      return interaction.reply({
        content: "❌ You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      let deletedCount = 0;
      let failedCount = 0;
      const results = [];

      for (const channelId of config.channelIds) {
        try {
          const channel = await interaction.client.channels.fetch(channelId);
          if (!channel) {
            results.push(`❌ Could not find channel: ${channelId}`);
            failedCount++;
            continue;
          }

          // Find today's message in this channel
          const todaysMessage = await findTodaysMessage(channel, interaction.client.user.id);

          if (todaysMessage) {
            await todaysMessage.delete();
            deletedCount++;
            results.push(`✅ Deleted message in #${channel.name}`);
          } else {
            results.push(`ℹ️ No message found today in #${channel.name}`);
          }
        } catch (error) {
          console.error(`Error purging channel ${channelId}:`, error);
          results.push(`❌ Failed to purge channel: ${channelId} - ${error.message}`);
          failedCount++;
        }
      }

      const summary = `**Purge Complete**\n\n${results.join('\n')}\n\n**Summary:** ${deletedCount} deleted, ${failedCount} failed`;

      await interaction.editReply({
        content: summary,
      });

      console.log(`Purge command executed by ${interaction.user.tag}: ${deletedCount} messages deleted`);
    } catch (error) {
      console.error("Error executing purge command:", error);
      await interaction.editReply({
        content: "❌ An error occurred while purging messages.",
      });
    }
  },
};
