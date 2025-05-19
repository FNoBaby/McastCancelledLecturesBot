const axios = require('axios');
const cheerio = require('cheerio');
const { EmbedBuilder } = require('discord.js');
const moment = require('moment-timezone');

let lastFetchedLectures = [];
let lastFetchedDate = '';

async function fetchCancelledLectures() {
    try {
        const response = await axios.get('https://iict.mcast.edu.mt/cancelled-lectures/');
        const html = response.data;        //Save HTML into a file for debugging
        const fs = require('fs');
        fs.writeFileSync('cancelled-lectures-2.html', html);

        const $ = cheerio.load(html);        // Extract the date part from the description - make it more robust by checking multiple selectors
        let rawDatePart = '';
        
        // Try different selectors to find the date
        const possibleDateSelectors = [
            'article .entry-content h4 strong', // Original selector
            'article .entry-content p strong',  // Current format
            'article .entry-content strong',    // Generic strong tag
            '.entry-content p strong'           // Even more generic
        ];
        
        // Try each selector until we find date content
        for (const selector of possibleDateSelectors) {
            const dateElements = $(selector);
            if (dateElements.length > 0) {
                // Combine text from all strong elements
                let combinedText = '';
                dateElements.each((_, elem) => {
                    combinedText += $(elem).text().trim() + ' ';
                });
                
                if (combinedText.includes('Cancelled Lectures for') || 
                    combinedText.includes('May') || 
                    combinedText.includes('June') || 
                    combinedText.includes('July') ||
                    combinedText.includes('August') ||
                    combinedText.includes('September') ||
                    combinedText.includes('October') ||
                    combinedText.includes('November') ||
                    combinedText.includes('December') ||
                    combinedText.includes('January') ||
                    combinedText.includes('February') ||
                    combinedText.includes('March') ||
                    combinedText.includes('April')) {
                    
                    rawDatePart = combinedText.trim();
                    console.log(`Found date using selector: ${selector}`);
                    console.log(`Raw date: ${rawDatePart}`);
                    break;
                }
            }
        }
        
        // If no date found, try to construct it from the page title or use current date
        if (!rawDatePart) {
            const pageTitle = $('h2.page-title').text().trim();
            if (pageTitle.includes('Cancelled Lectures')) {
                const currentDate = new Date();
                rawDatePart = `Cancelled Lectures for ${currentDate.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
                console.log(`No date found in content, using current date: ${rawDatePart}`);
            }
        }
        
        // Extract the date part
        let datePart = rawDatePart;
        if (datePart.includes('Cancelled Lectures for')) {
            datePart = datePart.replace('Cancelled Lectures for', '').trim();
        }
        
        const description = `Cancelled Lectures for ${datePart}`;
        console.log(`Parsed description: ${description}`);

        // Parse the date string into a Date object with flexible format handling
        let parsedDate;
        try {
            parsedDate = moment.tz(datePart, ['dddd Do MMMM, YYYY', 'dddd Do MMMM YYYY', 'D MMMM YYYY', 'MMMM D, YYYY'], 'Europe/Amsterdam').toDate();
        } catch (e) {
            console.log(`Error parsing date: ${e.message}, using current date`);
            parsedDate = new Date();
        }        // Extract class names and the classes they are cancelled for with more robust selectors
        const cancelledLectures = [];
        
        // Try multiple selectors for finding the lecture information
        const possibleLectureSelectors = [
            'article .entry-content ul li',   // Original selector (list items)
            'article .entry-content p',       // Current format (paragraphs)
            '.entry-content p',               // More generic paragraphs
            '.entry-content div'              // Any divs in entry content
        ];
        
        // Define possible separators
        const possibleSeparators = ['—', '-', '&#8212;', '–'];
        
        // Try each selector
        for (const selector of possibleLectureSelectors) {
            const elements = $(selector);
            let foundLectures = false;
            
            elements.each((index, element) => {
                const text = $(element).text().trim();
                
                // Skip empty elements or headers
                if (!text || text.includes('Cancelled Lectures for') || text.length < 5) {
                    return; // continue to next element
                }
                
                // Try each separator
                for (const separator of possibleSeparators) {
                    if (text.includes(separator)) {
                        const parts = text.split(separator).map(item => item.trim()).filter(Boolean);
                        
                        if (parts.length >= 2) {
                            const className = parts[0];
                            const cancelledFor = parts[1];
                            const cancelledForList = cancelledFor.split(',').map(item => item.trim());
                            cancelledLectures.push({ className, cancelledFor: cancelledForList });
                            foundLectures = true;
                            break; // Found a separator that works
                        }
                    }
                }
            });
            
            if (foundLectures) {
                console.log(`Found lectures using selector: ${selector}`);
                break; // We found lectures with this selector, no need to try others
            }
        }
        
        console.log(`Found ${cancelledLectures.length} cancelled lectures`);        // Check if we actually found any lectures
        if (cancelledLectures.length === 0) {
            console.warn("No cancelled lectures found in the HTML. The page structure may have changed.");
            // Create a basic embed with a warning
            const embed = new EmbedBuilder()
                .setTitle("Cancelled Lectures")
                .setDescription(`${description}\n\nNo cancelled lectures found or unable to parse the page correctly.`)
                .setColor("Red");
                
            return { embed, date: parsedDate, error: "No lectures found" };
        }

        // Compare new lectures with the last fetched lectures
        const newLectures = cancelledLectures.filter(lecture => {
            return !lastFetchedLectures.some(lastLecture => 
                lastLecture?.className === lecture?.className && 
                JSON.stringify(lastLecture?.cancelledFor) === JSON.stringify(lecture?.cancelledFor)
            );
        });

        console.log(`Found ${newLectures.length} new cancelled lectures`);

        // Add new lectures to the last fetched lectures
        lastFetchedLectures = [...lastFetchedLectures, ...newLectures];
        lastFetchedDate = parsedDate;

        // Build the embed
        const embed = new EmbedBuilder()
            .setTitle("Cancelled Lectures")
            .setDescription(description)
            .setColor("Random");

        // Ensure the embed is not empty
        if (cancelledLectures.length > 0) {
            cancelledLectures.forEach(lecture => {
                if (lecture?.className && lecture?.cancelledFor) {
                    embed.addFields({ 
                        name: lecture.className, 
                        value: Array.isArray(lecture.cancelledFor) ? lecture.cancelledFor.join(', ') : lecture.cancelledFor.toString(),
                        inline: false 
                    });
                }
            });
        }

        // Return the embed and the date
        return { embed, date: parsedDate, lectures: cancelledLectures };    } catch (error) {
        console.error('Error fetching cancelled lectures:', error);
        
        // Create an error embed
        const errorEmbed = new EmbedBuilder()
            .setTitle("Error Fetching Cancelled Lectures")
            .setDescription(`There was an error fetching the cancelled lectures. Error: ${error.message}`)
            .setColor("Red");
            
        return { 
            embed: errorEmbed, 
            date: new Date(), 
            error: error.message 
        };
    }
}

async function resetCancelledLecturesArray(){
    lastFetchedDate = '';
    lastFetchedLectures = [];
    console.log('Cancelled lectures array reset.');
}
// Function to test the fetching without affecting the Discord bot
async function testFetch() {
    console.log("Testing fetch cancelled lectures...");
    const result = await fetchCancelledLectures();
    console.log("Test result:", JSON.stringify(result, null, 2));
    return result;
}

module.exports = { fetchCancelledLectures, resetCancelledLecturesArray, testFetch };

// Uncomment this line to test the fetch function directly
// testFetch();
