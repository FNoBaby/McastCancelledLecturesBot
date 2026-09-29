const crypto = require("crypto");
const config = require("../../config.json");
const {
  DEFAULT_CLASSES,
  getTimetables,
  buildTimetableEmbed,
} = require("./fetchTimetable");
const { getChannelState, setChannelState } = require("./sharedState");

let syncing = null;

// Classes to monitor come from config.timetableClasses (e.g. ["SWD-6.1B", "SWD-6.2B"]).
function getSharedClasses() {
  return config.timetableClasses || DEFAULT_CLASSES;
}

function getTimetableChannelIds() {
  return config.timetableChannelIds || config.channelIds || [];
}

// The PDF headers use an "IT-" prefix (IT-SWD-6.1B); accept config values with or without it.
function resolveClassName(name, timetables) {
  if (timetables[name]) return name;
  if (timetables[`IT-${name}`]) return `IT-${name}`;
  return null;
}

// Each class gets its own message and its own shared-state entry, so one class
// changing in the PDF only edits that class's message.
async function syncTimetableMessages(client, { force = false } = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const data = await getTimetables();

      for (const configured of getSharedClasses()) {
        const className = resolveClassName(configured, data.timetables);
        if (!className) {
          console.warn(`Timetable class "${configured}" not found in the PDF.`);
          continue;
        }
        const embed = buildTimetableEmbed(className, data.timetables[className], data);
        const classHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(data.timetables[className]))
          .digest("hex");

        for (const channelId of getTimetableChannelIds()) {
          const key = `timetable:${channelId}:${className}`;
          const state = getChannelState(key) || {};
          try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) continue;

            let message = null;
            if (state.messageId) {
              try {
                message = await channel.messages.fetch(state.messageId);
              } catch (error) {
                message = null; // deleted; send a new one below
              }
            }

            if (message) {
              if (force || state.hash !== classHash) {
                await message.edit({ embeds: [embed] });
              }
            } else {
              message = await channel.send({ embeds: [embed] });
            }
            setChannelState(key, { messageId: message.id, hash: classHash });
          } catch (error) {
            console.error(`Timetable sync failed for ${className} in ${channelId}:`, error);
          }
        }
      }
      return data;
    } catch (error) {
      console.error("Error syncing timetables:", error);
      return null;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

module.exports = { syncTimetableMessages, getSharedClasses };
