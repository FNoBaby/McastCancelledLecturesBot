const { SlashCommandBuilder } = require("@discordjs/builders");
const config = require("../../config.json");
const fs = require("fs");
const path = require("path");
const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unregister")
    .setDescription("Unregister a channel from receiving cancelled lectures updates (Dev only)"),
  async execute(interaction) {
    // Check if user is the developer
    if (interaction.user.id !== config.devId) {
      return interaction.reply({
        content: "❌ You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    try {
      // Get all registered channels with their info
      const channelOptions = [];
      
      for (const channelId of config.channelIds) {
        try {
          const channel = await interaction.client.channels.fetch(channelId);
          if (channel) {
            channelOptions.push({
              label: `#${channel.name}`,
              description: `${channel.guild.name}`,
              value: channelId,
            });
          }
        } catch (error) {
          // Channel not found or no access
          console.error(`Could not fetch channel ${channelId}:`, error.message);
          channelOptions.push({
            label: `#unknown-channel`,
            description: `(Channel not found - ID: ${channelId})`,
            value: channelId,
          });
        }
      }

      if (channelOptions.length === 0) {
        return interaction.reply({
          content: "❌ No channels are currently registered.",
          ephemeral: true,
        });
      }

      // Create a select menu with all registered channels
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("unregister_select")
        .setPlaceholder("Select a channel to unregister")
        .addOptions(channelOptions);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.reply({
        content: `**Registered Channels (${channelOptions.length})**\n\nSelect a channel to unregister:`,
        components: [row],
        ephemeral: true,
      });

      // Listen for the select menu interaction
      const filter = (i) => i.customId === "unregister_select" && i.user.id === interaction.user.id;
      const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

      collector.on("collect", async (selectInteraction) => {
        const selectedChannelId = selectInteraction.values[0];

        try {
          // Remove the channel from config
          const index = config.channelIds.indexOf(selectedChannelId);
          if (index > -1) {
            config.channelIds.splice(index, 1);

            // Write the updated config back to the file
            const configPath = path.join(__dirname, "../../config.json");
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

            // Reload the config module cache
            delete require.cache[require.resolve("../../config.json")];

            const channel = await interaction.client.channels.fetch(selectedChannelId).catch(() => null);
            const channelName = channel ? `#${channel.name}` : `#unknown-channel`;
            const serverName = channel ? channel.guild.name : "Unknown Server";

            await selectInteraction.reply({
              content: `✅ Successfully unregistered channel **${channelName}** from server **${serverName}**\n\nRemaining registered channels: ${config.channelIds.length}`,
              ephemeral: true,
            });

            console.log(`Channel ${selectedChannelId} unregistered by ${interaction.user.tag}`);
          } else {
            await selectInteraction.reply({
              content: "❌ Channel not found in config.",
              ephemeral: true,
            });
          }
        } catch (error) {
          console.error("Error unregistering channel:", error);
          await selectInteraction.reply({
            content: "❌ An error occurred while unregistering the channel.",
            ephemeral: true,
          });
        }
      });

      collector.on("end", () => {
        // Do nothing if no interaction was received (timeout)
      });
    } catch (error) {
      console.error("Error executing unregister command:", error);
      await interaction.reply({
        content: "❌ An error occurred while executing the command.",
        ephemeral: true,
      });
    }
  },
};
