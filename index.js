const Discord = require('discord.js');
const cron = require('node-cron');
const config = require('./config.json');
const fetchCancelledLectures = require('./functions/fetchCancelledLectures');
const refreshCommand = require('./commands/refresh');
const refreshAllCommand = require('./commands/refreshAll');
const { setLastMessageId, getLastMessageId } = require('./functions/sharedState');

const client = new Discord.Client({
    intents: [
        Discord.IntentsBitField.Flags.Guilds,
        Discord.IntentsBitField.Flags.GuildMessages,
        Discord.IntentsBitField.Flags.MessageContent
    ]
});

client.login(config.token);

const rest = new Discord.REST().setToken(config.token);

client.on('ready', async () => {
    console.log('Bot is ready');

    try {
        console.log("Re-registering commands...");

        await rest.put(
            Discord.Routes.applicationCommands(config.clientId),
            {
                body: [
                    {
                        name: "refresh",
                        description: "Refresh the Cancelled Lectures list"
                    },
                    {
                        name: "refreshall",
                        description: "Refresh the Cancelled Lectures list in all channels"
                    }
                ]
            }
        );
        console.log('Successfully registered application commands.');
    } catch (error) {
        console.error('Error registering application commands:', error);
    }

    // Schedule task to run every day at 8:00:59 AM except weekends
    cron.schedule('/0 8 * * * 1-5', async () => {
        try {
            const embed = await fetchCancelledLectures();
            if (embed) {
                for (const channelId of config.channelIds) {
                    const channel = await client.channels.fetch(channelId);
                    const lastMessageId = getLastMessageId(channelId);
                    if (lastMessageId) {
                        const lastMessage = await channel.messages.fetch(lastMessageId);
                        if (lastMessage.embeds[0].description === embed.description) {
                            const noNewLecturesEmbed = new Discord.EmbedBuilder()
                                .setTitle("Cancelled Lectures")
                                .setDescription("Lectures not published yet. use /refresh to check again")
                                .setColor('Random')
                                .setFooter({ text: `Last Checked: ${new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'short' })}` });
                            await channel.send({ embeds: [noNewLecturesEmbed] });
                            continue;
                        }
                    }
                    const message = await channel.send({ embeds: [embed] });
                    setLastMessageId(channelId, message.id);
                }
            } else {
                console.error('Failed to fetch the latest cancelled lectures.');
            }
        } catch (error) {
            console.error('Error sending scheduled lectures:', error);
        }
    });

    // Schedule task to run every 1 minute
    cron.schedule('* * * * *', async () => {
        try {
            const embed = await fetchCancelledLectures();
            if (embed) {
                for (const channelId of config.channelIds) {
                    const channel = await client.channels.fetch(channelId);
                    const lastMessageId = getLastMessageId(channelId);
                    if (lastMessageId) {
                        const lastMessage = await channel.messages.fetch(lastMessageId);
                        if (lastMessage.embeds[0].description === embed.description) {
                            const noNewLecturesEmbed = new Discord.EmbedBuilder()
                                .setTitle("Cancelled Lectures")
                                .setDescription("Lectures not published yet. use /refresh to check again")
                                .setColor('Random')
                                .setFooter({ text: `Last Checked: ${new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'short' })}` });
                            await channel.send({ embeds: [noNewLecturesEmbed] });
                            continue;
                        }
                    }
                    const message = await channel.send({ embeds: [embed] });
                    setLastMessageId(channelId, message.id);
                }
            } else {
                console.error('Failed to fetch the latest cancelled lectures.');
            }
        } catch (error) {
            console.error('Error sending scheduled lectures:', error);
        }
    });
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'refresh') {
        await refreshCommand.execute(interaction);
    } else if (commandName === 'refreshall') {
        await refreshAllCommand.execute(interaction);
    }
});