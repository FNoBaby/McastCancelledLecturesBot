const Discord = require('discord.js');
const cron = require('node-cron');
const config = require('./config.json');
const fetchCancelledLectures = require('./src/functions/fetchCancelledLectures');
const refreshCommand = require('./src/commands/refresh');
const refreshAllCommand = require('./src/commands/refreshAll');
const { setLastMessageId, getLastMessageId } = require('./src/functions/sharedState');

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

        const commands = [
            {
                name: "refresh",
                description: "Refresh the Cancelled Lectures list"
            }
        ];

        if (config.devId) {
            commands.push({
                name: "refreshall",
                description: "Refresh the Cancelled Lectures list in all channels"
            });
        }

        await rest.put(
            Discord.Routes.applicationCommands(config.clientId),
            { body: commands }
        );
        console.log('Successfully registered application commands.');
    } catch (error) {
        console.error('Error registering application commands:', error);
    }

    // Schedule task to run every minute between 7:30 and 8:00 AM except weekends
    let lecturesFound = false;
    cron.schedule('30-59 7 * * 1-5, 0-29 8 * * 1-5', async () => {
        if (lecturesFound) return;

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
                        } else {
                            lecturesFound = true;
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

    // Reset lecturesFound at 8:00:30 AM every day and send "lectures not yet published" message if no new lectures were found
    cron.schedule('0 8 * * 1-5', async () => {
        if (!lecturesFound) {
            for (const channelId of config.channelIds) {
                const channel = await client.channels.fetch(channelId);
                const noNewLecturesEmbed = new Discord.EmbedBuilder()
                    .setTitle("Cancelled Lectures")
                    .setDescription("Lectures not published yet. use /refresh to check again")
                    .setColor('Random')
                    .setFooter({ text: `Last Checked: ${new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'short' })}` });
                await channel.send({ embeds: [noNewLecturesEmbed] });
            }
        }
        lecturesFound = false;
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