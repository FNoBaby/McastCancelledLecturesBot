const { SlashCommandBuilder } = require("@discordjs/builders");
const config = require("../../config.json");
const moment = require("moment-timezone");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("purgeall")
    .setDescription("Purge ALL of today's bot messages from ALL servers (Dev only)"),
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
      let skippedCount = 0;
      const results = [];
      const today = moment.tz('Europe/Amsterdam').startOf('day');

      // Iterate through all guilds the bot is in
      for (const guild of interaction.client.guilds.cache.values()) {
        results.push(`\n**${guild.name}**`);
        
        // Iterate through all text channels in the guild
        for (const channel of guild.channels.cache.values()) {
          // Only process text channels
          if (channel.type !== 0) continue; // 0 = GUILD_TEXT
          
          try {
            // Check if bot has permission to read and manage messages in this channel
            const permissions = channel.permissionsFor(interaction.client.user);
            if (!permissions || !permissions.has('ViewChannel') || !permissions.has('ReadMessageHistory')) {
              skippedCount++;
              continue;
            }

            // Fetch recent messages (limit 50 to avoid rate limits)
            const messages = await channel.messages.fetch({ limit: 50 });
            
            // Find all messages from the bot sent today
            const todaysMessages = messages.filter(msg => {
              if (msg.author.id !== interaction.client.user.id) return false;
              
              const msgDate = moment.tz(msg.createdAt, 'Europe/Amsterdam').startOf('day');
              return msgDate.isSame(today, 'day');
            });

            // Delete all found messages
            for (const message of todaysMessages.values()) {
              try {
                await message.delete();
                deletedCount++;
              } catch (delError) {
                console.error(`Failed to delete message ${message.id}:`, delError);
                failedCount++;
              }
            }

            if (todaysMessages.size > 0) {
              results.push(`  ✅ #${channel.name}: ${todaysMessages.size} deleted`);
            }
          } catch (error) {
            console.error(`Error processing channel ${channel.name} in ${guild.name}:`, error);
            results.push(`  ❌ #${channel.name}: ${error.message}`);
            failedCount++;
          }
        }
      }

      const summary = `**Purge All Complete**\n${results.join('\n')}\n\n**Summary:** ${deletedCount} deleted, ${failedCount} failed, ${skippedCount} skipped`;

      // Split response if it's too long (Discord has a 2000 character limit)
      if (summary.length > 1900) {
        const shortSummary = `**Purge All Complete**\n\n**Summary:** ${deletedCount} messages deleted across all servers, ${failedCount} failed, ${skippedCount} skipped`;
        await interaction.editReply({
          content: shortSummary,
        });
      } else {
        await interaction.editReply({
          content: summary,
        });
      }

      console.log(`PurgeAll command executed by ${interaction.user.tag}: ${deletedCount} messages deleted across all servers`);
    } catch (error) {
      console.error("Error executing purgeall command:", error);
      await interaction.editReply({
        content: "❌ An error occurred while purging messages.",
      });
    }
  },
};
