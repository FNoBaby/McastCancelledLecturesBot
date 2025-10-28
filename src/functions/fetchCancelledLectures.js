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
        
        // Extract the date from the new structure (h3 strong tag)
        let rawDatePart = '';
        
        // Try the newest format first (h3 strong)
        const h3DateElement = $('article .entry-content h3 strong');
        if (h3DateElement.length > 0) {
            rawDatePart = h3DateElement.first().text().trim();
            console.log(`Found date in h3 strong: ${rawDatePart}`);
        }
        
        // Try the previous format (h4 strong) as fallback
        if (!rawDatePart) {
            const h4DateElement = $('article .entry-content h4 strong');
            if (h4DateElement.length > 0) {
                rawDatePart = h4DateElement.first().text().trim();
                console.log(`Found date in h4 strong: ${rawDatePart}`);
            }
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
            parsedDate = moment.tz(datePart, ['dddd Do MMMM, YYYY', 'dddd Do MMMM YYYY', 'D MMMM YYYY', 'MMMM D, YYYY', 'dddd D MMMM YYYY', 'D MMMM, YYYY'], 'Europe/Amsterdam').toDate();
        } catch (e) {
            console.log(`Error parsing date: ${e.message}, using current date`);
            parsedDate = new Date();
        }

        // Helper to parse a single line like "Class Name  —  Group1, Group2"
        function parseLectureLine(line) {
            const cleanLine = $('<div>').html(line).text().trim();
            if (!cleanLine || cleanLine.length <= 5) return null;
            // Ignore the UNTIL FURTHER NOTICE header lines
            if (cleanLine.toUpperCase().includes('UNTIL FURTHER NOTICE')) return null;

            // Split on em-dash / en-dash / hyphen (after decoding entities)
            const parts = cleanLine.split(/[—–-]/).map(p => p.trim()).filter(Boolean);
            if (parts.length < 2) return null;

            const className = parts[0];
            const cancelledFor = parts.slice(1).join(' — ');
            const cancelledForList = cancelledFor.split(',').map(item => item.trim()).filter(Boolean);

            if (!className || cancelledForList.length === 0) return null;

            return { className, cancelledFor: cancelledForList };
        }

        // Extract cancelled lectures
        const cancelledLectures = [];
        
        // 1) Parse <p><strong>...</strong> blocks where lines are separated by <br/>
        const pStrongElements = $('article .entry-content > p > strong, article .entry-content p strong');
        pStrongElements.each((_, elem) => {
            const $elem = $(elem);
            const innerHtml = $elem.html();
            if (!innerHtml) return;

            // Split on <br> tags (handle variations)
            const lines = innerHtml.split(/<br\s*\/?>/i);
            lines.forEach(rawLine => {
                const lecture = parseLectureLine(rawLine);
                if (lecture) {
                    cancelledLectures.push(lecture);
                }
            });
        });

        // 2) Process daily cancelled lectures from h5 tags and their p elements (existing logic)
        const h5Elements = $('article .entry-content h5');
        h5Elements.each((_, h5Element) => {
            const $h5 = $(h5Element);
            
            // Get text content and HTML content to handle both inline and paragraph formats
            let content = $h5.html();
            
            if (content) {
                // Split by <p> tags and process each part
                const parts = content.split(/<\/?p[^>]*>/i);
                
                parts.forEach(part => {
                    if (part.trim()) {
                        const cleanLine = $('<div>').html(part).text().trim();
                        
                        if (cleanLine && 
                            !cleanLine.includes('UNTIL FURTHER NOTICE') && 
                            cleanLine.length > 5) {
                            
                            const lecture = parseLectureLine(cleanLine);
                            if (lecture) cancelledLectures.push(lecture);
                        }
                    }
                });
            }
        });
        
        // Also check for p elements after h5 (in case structure varies)
        const pAfterH5 = $('article .entry-content h5').nextAll('p');
        pAfterH5.each((_, pElement) => {
            const $p = $(pElement);
            const innerHtml = $p.html() || '';
            // split by <br> if present otherwise treat as single line
            const lines = innerHtml.split(/<br\s*\/?>/i);
            lines.forEach(line => {
                const lecture = parseLectureLine(line);
                if (lecture) cancelledLectures.push(lecture);
            });
        });
        
        // 3) Process the "UNTIL FURTHER NOTICE" section
        const untilNoticeDiv = $('.wp-block-group .wp-block-group__inner-container p');
        untilNoticeDiv.each((_, element) => {
            const $elem = $(element);
            const html = $elem.html();
            
            if (html && html.toUpperCase().includes('UNTIL FURTHER NOTICE')) {
                // Split by <br> tags to get individual lecture lines
                const lectureLines = html.split(/<br\s*\/?>/i);
                
                lectureLines.forEach(line => {
                    // Remove HTML tags and decode entities
                    const cleanLine = $('<div>').html(line).text().trim();
                    
                    if (cleanLine && 
                        !cleanLine.toUpperCase().includes('UNTIL FURTHER NOTICE') && 
                        cleanLine.length > 5) {
                        
                        const parts = cleanLine.split(/[—–-]/).map(part => part.trim()).filter(Boolean);
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
        
        // Check if we actually found any lectures
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
