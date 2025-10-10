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
        
        // Save HTML into a file for debugging
        const fs = require('fs');
        fs.writeFileSync('cancelled-lectures-2.html', html);

        const $ = cheerio.load(html);
        
        // Extract the date from h4 strong tag (new format)
        let rawDatePart = '';
        
        // Try the new format first (h4 strong)
        const h4DateElement = $('article .entry-content h4 strong');
        if (h4DateElement.length > 0) {
            rawDatePart = h4DateElement.first().text().trim();
            console.log(`Found date in h4 strong: ${rawDatePart}`);
        }
        
        // If not found, try the old selectors as fallback
        if (!rawDatePart) {
            const possibleDateSelectors = [
                'article .entry-content p strong',
                'article .entry-content strong',
                '.entry-content p strong'
            ];
            
            for (const selector of possibleDateSelectors) {
                const dateElements = $(selector);
                if (dateElements.length > 0) {
                    let combinedText = '';
                    dateElements.each((_, elem) => {
                        combinedText += $(elem).text().trim() + ' ';
                    });
                    
                    if (combinedText.includes('Cancelled Lectures for') || 
                        combinedText.includes('Monday') || combinedText.includes('Tuesday') || 
                        combinedText.includes('Wednesday') || combinedText.includes('Thursday') || 
                        combinedText.includes('Friday') || combinedText.includes('Saturday') || 
                        combinedText.includes('Sunday') ||
                        combinedText.includes('January') || combinedText.includes('February') ||
                        combinedText.includes('March') || combinedText.includes('April') ||
                        combinedText.includes('May') || combinedText.includes('June') ||
                        combinedText.includes('July') || combinedText.includes('August') ||
                        combinedText.includes('September') || combinedText.includes('October') ||
                        combinedText.includes('November') || combinedText.includes('December')) {
                        
                        rawDatePart = combinedText.trim();
                        console.log(`Found date using fallback selector: ${selector}`);
                        console.log(`Raw date: ${rawDatePart}`);
                        break;
                    }
                }
            }
        }
        
        // If no date found, use current date
        if (!rawDatePart) {
            const currentDate = new Date();
            rawDatePart = currentDate.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            console.log(`No date found in content, using current date: ${rawDatePart}`);
        }
        
        // Clean up the date part
        let datePart = rawDatePart;
        if (datePart.includes('Cancelled Lectures for')) {
            datePart = datePart.replace('Cancelled Lectures for', '').trim();
        }
        
        const description = `Cancelled Lectures for ${datePart}`;
        console.log(`Parsed description: ${description}`);

        // Parse the date string into a Date object
        let parsedDate;
        try {
            parsedDate = moment.tz(datePart, ['dddd Do MMMM, YYYY', 'dddd Do MMMM YYYY', 'D MMMM YYYY', 'MMMM D, YYYY'], 'Europe/Amsterdam').toDate();
        } catch (e) {
            console.log(`Error parsing date: ${e.message}, using current date`);
            parsedDate = new Date();
        }

        // Extract cancelled lectures
        const cancelledLectures = [];
        
        // Helper function to decode HTML entities and clean text
        const decodeAndClean = (text) => {
            return text
                .replace(/&#8212;/g, '—')  // Replace HTML entity for em dash
                .replace(/&mdash;/g, '—')   // Replace named entity for em dash
                .replace(/&nbsp;/g, ' ')    // Replace non-breaking space
                .replace(/&amp;/g, '&')    // Replace ampersand
                .trim();
        };
        
        // Process the main cancelled lectures section (first p tag after h4)
        const mainLecturesP = $('article .entry-content h4').next('p');
        if (mainLecturesP.length > 0) {
            // Get the text content and decode entities
            const mainText = mainLecturesP.text();
            const decodedText = decodeAndClean(mainText);
            
            // Split by line breaks and process each line
            const lines = decodedText.split(/\n/).map(line => line.trim()).filter(Boolean);
            
            lines.forEach(line => {
                if (line && !line.includes('UNTIL FURTHER NOTICE') && !line.includes('***')) {
                    // Parse lines with em dash separator
                    if (line.includes('—')) {
                        const parts = line.split('—').map(part => part.trim());
                        if (parts.length >= 2) {
                            const className = parts[0].trim();
                            const cancelledFor = parts.slice(1).join(' — ').trim();
                            const cancelledForList = cancelledFor.split(',').map(item => item.trim()).filter(Boolean);
                            
                            if (className && cancelledForList.length > 0) {
                                cancelledLectures.push({ 
                                    className: className, 
                                    cancelledFor: cancelledForList 
                                });
                            }
                        }
                    }
                }
            });
        }
        
        // Process the "UNTIL FURTHER NOTICE" section
        const untilNoticeDiv = $('.wp-block-group .wp-block-group__inner-container p');
        untilNoticeDiv.each((_, element) => {
            const $elem = $(element);
            const text = $elem.text();
            const decodedText = decodeAndClean(text);
            
            if (decodedText.includes('UNTIL FURTHER NOTICE')) {
                // Split by line breaks and process each line
                const lines = decodedText.split(/\n/).map(line => line.trim()).filter(Boolean);
                
                lines.forEach(line => {
                    if (line && 
                        !line.includes('UNTIL FURTHER NOTICE') && 
                        !line.includes('***') &&
                        line.length > 5 &&
                        line.includes('—')) {
                        
                        // Parse lines with em dash separator
                        const parts = line.split('—').map(part => part.trim());
                        if (parts.length >= 2) {
                            const className = parts[0].trim();
                            const cancelledFor = parts.slice(1).join(' — ').trim();
                            const cancelledForList = cancelledFor.split(',').map(item => item.trim()).filter(Boolean);
                            
                            if (className && cancelledForList.length > 0) {
                                cancelledLectures.push({ 
                                    className: className + ' (Until Further Notice)', 
                                    cancelledFor: cancelledForList 
                                });
                            }
                        }
                    }
                });
            }
        });
        
        console.log(`Found ${cancelledLectures.length} cancelled lectures`);
        
        // Debug: log what we found
        console.log('Cancelled lectures found:');
        cancelledLectures.forEach((lecture, index) => {
            console.log(`${index + 1}. ${lecture.className} — ${lecture.cancelledFor.join(', ')}`);
        });
        
        // Check if we actually found any lectures
        if (cancelledLectures.length === 0) {
            console.warn("No cancelled lectures found in the HTML. The page structure may have changed.");
            
            // Debug: log the raw text we're trying to parse
            const mainP = $('article .entry-content h4').next('p');
            const untilNoticeP = $('.wp-block-group .wp-block-group__inner-container p');
            
            console.log('Main P text:', mainP.text());
            console.log('Until Notice P text:', untilNoticeP.text());
            
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
        return { embed, date: parsedDate, lectures: cancelledLectures };
        
    } catch (error) {
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
