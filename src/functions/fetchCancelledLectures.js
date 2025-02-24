const axios = require('axios');
const cheerio = require('cheerio');
const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

let lastFetchedLectures = [];
let lastFetchedDate = '';

async function fetchCancelledLectures() {
    try {
        const response = await axios.get('https://iict.mcast.edu.mt/cancelled-lectures/');
        const html = response.data;
        const $ = cheerio.load(html);

        // Extract the date part from the description
        const rawDatePart = $('article .entry-content h4 strong').first().text().trim() + $('article .entry-content h4 strong').last().text().trim();
        const datePart = rawDatePart.replace('Cancelled Lectures for ', '').trim();
        const description = `Cancelled Lectures for ${datePart}`;

        // Parse the date string into a Date object
        const parsedDate = moment.tz(datePart, 'dddd Do MMMM, YYYY', 'Europe/Amsterdam').toDate();

        // Extract class names and the classes they are cancelled for
        const cancelledLectures = [];
        $('article .entry-content ul li').each((index, element) => {
            const text = $(element).text();
            const [className, cancelledFor] = text.split('—').map(item => item.trim());
            const cancelledForList = cancelledFor.split(',').map(item => item.trim());
            cancelledLectures.push({ className, cancelledFor: cancelledForList });
        });

        // Compare new lectures with the last fetched lectures
        const newLectures = cancelledLectures.filter(lecture => {
            return !lastFetchedLectures.some(lastLecture => 
                lastLecture.className === lecture.className && 
                JSON.stringify(lastLecture.cancelledFor) === JSON.stringify(lecture.cancelledFor)
            );
        });

        // Add new lectures to the last fetched lectures
        lastFetchedLectures = [...lastFetchedLectures, ...newLectures];
        lastFetchedDate = parsedDate;

        // Build the embed
        const embed = new EmbedBuilder()
            .setTitle("Cancelled Lectures")
            .setDescription(description)
            .setColor("Random");

        // Ensure the embed is not empty
        if (lastFetchedLectures.length > 0) {
            lastFetchedLectures.forEach(lecture => {
                embed.addFields({ name: lecture.className, value: lecture.cancelledFor.join(', '), inline: false });
            });
        }

        // Return the embed and the date
        return { embed, date: parsedDate };
    } catch (error) {
        console.error('Error fetching cancelled lectures:', error);
    }
}

module.exports = fetchCancelledLectures;
