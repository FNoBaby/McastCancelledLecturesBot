const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const getMotivationalQuote = require('../functions/getMotivationalQuote');
const config = require('../../config.json');

const cooldowns = new Map();
const cooldownAmount = 10000; // 10 seconds

module.exports = {
    data: new SlashCommandBuilder()
        .setName('motivateme')
        .setDescription('Get a motivational quote'),
    async execute(interaction) {
        const userId = interaction.user.id;
        const now = Date.now();

        if (userId !== config.devId) {
            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId) + cooldownAmount;
                if (now < expirationTime) {
                    const timeLeft = (expirationTime - now) / 1000;
                    return interaction.reply({
                        content: `Please wait ${timeLeft.toFixed(1)} more seconds before reusing the \`/motivateme\` command.`,
                        ephemeral: true,
                    });
                }
            }

            cooldowns.set(userId, now);
            setTimeout(() => cooldowns.delete(userId), cooldownAmount);
        }

        try {
            const quote = await getMotivationalQuote();
            const [quoteText, author] = quote.split(' - ');
            const embed = new EmbedBuilder()
                .setTitle("🌟 Motivational Quote 🌟")
                .setDescription(`## *"${quoteText}"*\n\n\n\n**- ${author}**`)
                .setColor("Random")
                .setFooter({ text: "Stay motivated! (Not Powered by MCAST)" });

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error executing motivateme command:', error);
            await interaction.reply({
                content: 'An error occurred while fetching the motivational quote.',
                ephemeral: true,
            });
        }
    },
};
