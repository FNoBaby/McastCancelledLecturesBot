const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const { EmbedBuilder } = require("discord.js");
const config = require("../../config.json");
const { getChannelState, setLastMessageId } = require("./sharedState");

// Cancellations registered by hand with /cancelled, for when the IICT page
// isn't being updated (e.g. during a strike). Stored per server, since each
// server only has its own classes.
const STORE_FILE = path.join(__dirname, "../../manual_cancellations.json");
const TZ = "Europe/Malta";

// Field names with this prefix are ours; parseLecturesEmbed skips them so they
// are never mistaken for lectures scraped from the site.
const MANUAL_PREFIX = "📌";

function todayKey() {
  return moment.tz(TZ).format("YYYY-MM-DD");
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Could not read manual_cancellations.json, starting empty:", error.message);
    }
    return [];
  }
}

let entries = load();

function save() {
  // Past days are never shown again, so drop them.
  const today = todayKey();
  entries = entries.filter((e) => e.date >= today);
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(entries, null, 2), "utf8");
  } catch (error) {
    console.error("Could not write manual_cancellations.json:", error);
  }
}

const sameLesson = (a, b) =>
  a.guildId === b.guildId &&
  a.className === b.className &&
  a.module === b.module &&
  a.date === b.date &&
  a.start === b.start;

// Returns false if it was already registered.
function addEntry(entry) {
  if (entries.some((e) => sameLesson(e, entry))) return false;
  entries.push({ ...entry, addedAt: new Date().toISOString() });
  save();
  return true;
}

// Returns the number of entries removed.
function removeEntry(entry) {
  const before = entries.length;
  entries = entries.filter((e) => !sameLesson(e, entry));
  save();
  return before - entries.length;
}

// Today's and upcoming entries for a server, sorted by date then time.
function getUpcomingEntries(guildId) {
  const today = todayKey();
  return entries
    .filter((e) => e.guildId === guildId && e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

function dateLabel(date) {
  const day = moment.tz(date, "YYYY-MM-DD", TZ);
  const label = day.format("dddd D MMMM");
  return date === todayKey() ? `Today (${label})` : label;
}

// Copy of `embed` with a "Manually Registered" section for this server.
// Never mutates the input: the same embed is reused across channels.
function withManualEntries(embed, guildId) {
  const upcoming = guildId ? getUpcomingEntries(guildId) : [];
  if (!embed || upcoming.length === 0) return embed;

  const copy = EmbedBuilder.from(embed.toJSON ? embed.toJSON() : embed);
  const byDate = new Map();
  for (const e of upcoming) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  const room = 25 - (copy.data.fields?.length || 0);
  const fields = [...byDate.entries()].slice(0, Math.max(room, 0)).map(([date, list]) => ({
    name: `${MANUAL_PREFIX} Manually Registered — ${dateLabel(date)}`,
    value: list
      .map((e) => `**${e.className}** — ${e.module} \`${e.start}–${e.end}\``)
      .join("\n")
      .slice(0, 1024),
    inline: false,
  }));
  if (fields.length) copy.addFields(fields);
  return copy;
}

// Re-applies the manual section to the tracked Cancelled Lectures message in
// every registered channel of this server, sending one if there is none yet.
async function refreshGuildMessages(client, guildId) {
  for (const channelId of config.channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.guildId !== guildId) continue;

      const state = getChannelState(channelId);
      let message = null;
      if (state?.messageId) {
        message = await channel.messages.fetch(state.messageId).catch(() => null);
      }

      // Start from the current embed without our old section.
      const base = message?.embeds[0]
        ? EmbedBuilder.from(message.embeds[0]).setFields(
            (message.embeds[0].fields || []).filter((f) => !f.name.startsWith(MANUAL_PREFIX))
          )
        : new EmbedBuilder()
            .setTitle("Cancelled Lectures")
            .setDescription("**Lectures not published yet. Use /refresh to check again.**")
            .setColor("Random");
      const embed = withManualEntries(base, guildId);

      if (message) {
        await message.edit({ embeds: [embed] });
      } else {
        message = await channel.send({ embeds: [embed] });
        setLastMessageId(channelId, message.id, todayKey());
      }
    } catch (error) {
      console.error(`Could not update manual cancellations in channel ${channelId}:`, error);
    }
  }
}

module.exports = {
  MANUAL_PREFIX,
  addEntry,
  removeEntry,
  getUpcomingEntries,
  withManualEntries,
  refreshGuildMessages,
};
