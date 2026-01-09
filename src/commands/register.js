const { SlashCommandBuilder } = require("@discordjs/builders");
const config = require("../../config.json");
const fs = require("fs");
const path = require("path");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("register")
    .setDescription("Register a channel to receive cancelled lectures updates (Dev only)")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("The channel to register")
        .setRequired(true)
    ),
  async execute(interaction) {
    // Check if user is the developer
    if (interaction.user.id !== config.devId) {
      return interaction.reply({
        content: "❌ You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    const channel = interaction.options.getChannel("channel");

    // Check if channel was provided
    if (!channel) {
      return interaction.reply({
        content: "❌ Please provide a channel.",
        ephemeral: true,
      });
    }

    // Check if it's a text channel
    if (channel.type !== 0) {
      return interaction.reply({
        content: "❌ Please select a text channel.",
        ephemeral: true,
      });
    }

    try {
      // Check if channel is already registered
      if (config.channelIds.includes(channel.id)) {
        return interaction.reply({
          content: `ℹ️ Channel <#${channel.id}> is already registered.`,
          ephemeral: true,
        });
      }

      // Add the channel ID to the config
      config.channelIds.push(channel.id);

      // Write the updated config back to the file
      const configPath = path.join(__dirname, "../../config.json");
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

      // Reload the config module cache
      delete require.cache[require.resolve("../../config.json")];
      
      await interaction.reply({
        content: `✅ Successfully registered channel <#${channel.id}> (${channel.name}) in server **${channel.guild.name}**\n\nTotal registered channels: ${config.channelIds.length}`,
        ephemeral: true,
      });

      console.log(`Channel ${channel.name} (${channel.id}) registered by ${interaction.user.tag}`);
    } catch (error) {
      console.error("Error registering channel:", error);
      await interaction.reply({
        content: "❌ An error occurred while registering the channel.",
        ephemeral: true,
      });
    }
  },
};
