const lastMessageIds = {};

module.exports = {
    getLastMessageId: (channelId) => lastMessageIds[channelId] || null,
    setLastMessageId: (channelId, messageId) => { lastMessageIds[channelId] = messageId; }
};
