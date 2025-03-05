const axios = require('axios');

async function getMotivationalQuote() {
    try {
        const response = await axios.get('https://zenquotes.io/api/random');
        const quote = response.data[0].q + " - " + response.data[0].a;
        return quote;
    } catch (error) {
        console.error('Error fetching motivational quote:', error);
        return 'Keep pushing forward!';
    }
}

module.exports = getMotivationalQuote;
