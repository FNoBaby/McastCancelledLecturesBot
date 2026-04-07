const moment = require("moment-timezone");

const channelState = {};

function getChannelState(channelId) {
    return channelState[channelId] || null;
}

function setChannelState(channelId, state) {
    const currentState = channelState[channelId] || {};
    channelState[channelId] = {
        ...currentState,
        ...state,
    };
}

module.exports = {
    getLastMessageId: (channelId) => getChannelState(channelId)?.messageId || null,
    setLastMessageId: (channelId, messageId, dateKey = null) => {
        const state = { messageId };
        if (dateKey) {
            state.dateKey = dateKey;
        }
        setChannelState(channelId, state);
    },
    // Find today's Cancelled Lectures message from the bot in the specified channel.
    findTodaysMessage: async (channel, botId) => {
        try {
            const today = moment.tz("Europe/Amsterdam").startOf("day");
            const messages = await channel.messages.fetch({ limit: 50 });

            const todaysMessage = messages.find((msg) => {
                if (msg.author.id !== botId) return false;
                if (msg.embeds.length === 0) return false;
                if (!msg.embeds[0].title?.includes("Cancelled Lectures")) return false;

                const msgDate = moment.tz(msg.createdAt, "Europe/Amsterdam").startOf("day");
                return msgDate.isSame(today, "day");
            });

            return todaysMessage || null;
        } catch (error) {
            console.error("Error finding today's message:", error);
            return null;
        }
    },
    getChannelState,
    setChannelState,
};
