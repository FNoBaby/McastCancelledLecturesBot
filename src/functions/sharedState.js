const moment = require('moment-timezone');

// In-memory storage for refresh command (temporary)
const lastMessageIds = {};

module.exports = {
    getLastMessageId: (channelId) => lastMessageIds[channelId] || null,
    
    setLastMessageId: (channelId, messageId) => {
        lastMessageIds[channelId] = messageId;
    },
    
    // Find today's message from the bot in the specified channel
    findTodaysMessage: async (channel, botId) => {
        try {
            const today = moment.tz('Europe/Amsterdam').startOf('day');
            
            // Fetch recent messages (limit 50 to avoid rate limits)
            const messages = await channel.messages.fetch({ limit: 50 });
            
            // Find the most recent message from the bot that was sent today
            const todaysMessage = messages.find(msg => {
                if (msg.author.id !== botId) return false;
                if (msg.embeds.length === 0) return false;
                if (!msg.embeds[0].title?.includes('Cancelled Lectures')) return false;
                
                const msgDate = moment.tz(msg.createdAt, 'Europe/Amsterdam').startOf('day');
                return msgDate.isSame(today, 'day');
            });
            
            return todaysMessage || null;
        } catch (error) {
            console.error('Error finding today\'s message:', error);
            return null;
        }
    }
};
