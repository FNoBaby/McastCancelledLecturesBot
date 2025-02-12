const { SlashCommandBuilder } = require('@discordjs/builders');
const fetchCancelledLectures = require('../functions/fetchCancelledLectures');
const config = require('../../config.json');
const { getLastMessageId, setLastMessageId } = require('../functions/sharedState');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('refreshall')
        .setDescription('Refresh and resend the latest cancelled lectures embed in all channels'),
    async execute(interaction) {
        if (interaction.user.id !== config.devId) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        try {
            const embed = await fetchCancelledLectures();
            if (embed) {
                for (const channelId of config.channelIds) {
                    const channel = await interaction.client.channels.fetch(channelId);
                    const lastMessageId = getLastMessageId(channelId);
                    const now = new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'short' });
                    embed.setFooter({ text: `Last Refreshed: ${now}` });

                    if (lastMessageId) {
                        try {
                            const message = await channel.messages.fetch(lastMessageId);
                            await message.edit({ embeds: [embed] });
                        } catch (fetchError) {
                            const message = await channel.send({ embeds: [embed] });
                            setLastMessageId(channelId, message.id);
                        }
                    } else {
                        const message = await channel.send({ embeds: [embed] });
                        setLastMessageId(channelId, message.id);
                    }
                }
                await interaction.reply({ content: 'The cancelled lectures embed has been refreshed in all channels.', ephemeral: true });
            } else {
                await interaction.reply({ content: 'Failed to fetch the latest cancelled lectures.', ephemeral: true });
            }
        } catch (error) {
            console.error('Error executing refreshall command:', error);
            await interaction.reply({ content: 'An error occurred while refreshing the cancelled lectures in all channels.', ephemeral: true });
        }
    }
};
