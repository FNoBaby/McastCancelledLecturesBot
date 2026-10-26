const crypto = require("crypto");
const config = require("../../config.json");
const {
  DEFAULT_CLASSES,
  getTimetables,
  buildTimetableEmbed,
  parseTimetableEmbed,
  seedCacheFromEmbeds,
} = require("./fetchTimetable");
const { getChannelState, setChannelState } = require("./sharedState");

let syncing = null;

// Which classes go to which channel. Preferred config:
//   "timetableChannels": { "CHANNEL_ID": ["SWD-6.1B"], "OTHER_ID": ["SWD-6.2B"] }
// Fallback (legacy): every class in timetableClasses goes to every timetableChannelIds channel.
function getTimetableTargets() {
  if (config.timetableChannels && typeof config.timetableChannels === "object") {
    return Object.entries(config.timetableChannels).map(([channelId, classes]) => ({
      channelId,
      classes: Array.isArray(classes) ? classes : [classes],
    }));
  }
  const classes = config.timetableClasses || DEFAULT_CLASSES;
  return (config.timetableChannelIds || config.channelIds || []).map((channelId) => ({
    channelId,
    classes,
  }));
}

function getSharedClasses() {
  return [...new Set(getTimetableTargets().flatMap((t) => t.classes))];
}

// The PDF headers use an "IT-" prefix (IT-SWD-6.1B); accept config values with or without it.
function resolveClassName(name, timetables) {
  if (timetables[name]) return name;
  if (timetables[`IT-${name}`]) return `IT-${name}`;
  return null;
}

// Rebuilds the timetables from the embeds the bot already posted.
async function loadTimetablesFromMessages(client) {
  const parsed = new Map();
  for (const { channelId, classes } of getTimetableTargets()) {
    for (const configured of classes) {
      for (const className of [configured, `IT-${configured}`]) {
        if (parsed.has(className)) continue;
        const messageId = getChannelState(`timetable:${channelId}:${className}`)?.messageId;
        if (!messageId) continue;
        try {
          const channel = await client.channels.fetch(channelId);
          const message = await channel.messages.fetch(messageId);
          const result = parseTimetableEmbed(message.embeds[0]);
          if (result) parsed.set(result.className, result);
        } catch (error) {
          // message or channel gone; try the next one
        }
      }
    }
  }
  return [...parsed.values()];
}

async function restoreFromMessages(client) {
  return seedCacheFromEmbeds(await loadTimetablesFromMessages(client));
}

// getTimetables, but if the IICT site is down and nothing is cached yet,
// fall back to the timetables already posted in Discord.
async function getTimetablesWithFallback(client) {
  try {
    return await getTimetables();
  } catch (error) {
    const restored = await restoreFromMessages(client);
    if (!restored) throw error;
    console.warn(
      `Timetable site unreachable (${error.message}); using ${restored.classes.length} timetable(s) from posted embeds.`
    );
    return restored;
  }
}

// Each class gets its own message and its own shared-state entry, so one class
// changing in the PDF only edits that class's message.
async function syncTimetableMessages(client, { force = false } = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const data = await getTimetablesWithFallback(client);
      // Must match the timezone buildTimetableEmbed uses for "today".
      const todayKey = new Date().toLocaleDateString("en-CA", {
        timeZone: "Europe/Malta",
      });

      for (const configured of getSharedClasses()) {
        const className = resolveClassName(configured, data.timetables);
        if (!className) {
          console.warn(`Timetable class "${configured}" not found in the PDF.`);
          continue;
        }
        const embed = buildTimetableEmbed(className, data.timetables[className], data);
        const classHash = crypto
          .createHash("sha256")
          // Include today's date so the "(today)" marker moves at midnight.
          .update(JSON.stringify(data.timetables[className]) + todayKey)
          .digest("hex");

        for (const { channelId, classes } of getTimetableTargets()) {
          if (!classes.includes(configured)) continue;
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

module.exports = {
  syncTimetableMessages,
  getSharedClasses,
  getTimetablesWithFallback,
  restoreFromMessages,
};
