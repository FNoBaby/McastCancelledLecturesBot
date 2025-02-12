const { SlashCommandBuilder } = require('@discordjs/builders');
const fetchCancelledLectures = require('../functions/fetchCancelledLectures');
const config = require('../../config.json');
const { getLastMessageId, setLastMessageId } = require('../functions/sharedState');

const cooldowns = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('refresh')
        .setDescription('Refresh and resend the latest cancelled lectures embed'),
    async execute(interaction) {
        const userId = interaction.user.id;
        const now = Date.now();
        const cooldownAmount = 5 * 60 * 1000; // 5 minutes in milliseconds

        if (userId !== config.devId) {
            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId) + cooldownAmount;
                if (now < expirationTime) {
                    const timeLeft = (expirationTime - now) / 1000;
                    return interaction.reply({ content: `Please wait ${timeLeft.toFixed(1)} more seconds before reusing the \`/refresh\` command.`, ephemeral: true });
                }
            }

            cooldowns.set(userId, now);
            setTimeout(() => cooldowns.delete(userId), cooldownAmount);
        }

        try {
            const embed = await fetchCancelledLectures();
            if (embed) {
                if (config.channelIds.includes(interaction.channel.id)) {
                    const lastMessageId = getLastMessageId(interaction.channel.id);
                    const now = new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'short' });
                    embed.setFooter({ text: `Last Refreshed: ${now}` });

                    if (lastMessageId) {
                        try {
                            const message = await interaction.channel.messages.fetch(lastMessageId);
                            await message.edit({ embeds: [embed] });
                            await interaction.reply({ content: 'The cancelled lectures embed has been updated.', ephemeral: true });
                        } catch (fetchError) {
                            const message = await interaction.reply({ embeds: [embed], fetchReply: true });
                            setLastMessageId(interaction.channel.id, message.id);
                            await interaction.followUp({ content: 'The cancelled lectures embed has been sent.', ephemeral: true });
                        }
                    } else {
                        const message = await interaction.reply({ embeds: [embed], fetchReply: true });
                        setLastMessageId(interaction.channel.id, message.id);
                        await interaction.followUp({ content: 'The cancelled lectures embed has been sent.', ephemeral: true });
                    }
                } else {
                    await interaction.reply({ content: 'This command can only be used in the designated channel.', ephemeral: true });
                }
            } else {
                await interaction.reply({ content: 'Failed to fetch the latest cancelled lectures.', ephemeral: true });
            }
        } catch (error) {
            console.error('Error executing refresh command:', error);
            await interaction.reply({ content: 'An error occurred while refreshing the cancelled lectures.', ephemeral: true });
        }
    }
};
