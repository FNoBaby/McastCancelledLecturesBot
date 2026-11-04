const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const { EmbedBuilder } = require("discord.js");
const config = require("../../config.json");
const { getChannelState, setLastMessageId } = require("./sharedState");
const { getTimetableTargets } = require("./timetableManager");

// Cancellations registered by hand with /cancelled, for when the IICT page
// isn't being updated (e.g. during a strike). They belong to the class, so every
// server with a timetable channel for that class sees them. `guildId` only
// records which server registered it.
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

const sameLesson = (a, b) =>
  a.className === b.className &&
  a.module === b.module &&
  a.date === b.date &&
  a.start === b.start;

// Older entries were per server; the same lecture registered in two servers is now one entry.
let entries = load().filter(
  (e, i, all) => all.findIndex((o) => sameLesson(o, e)) === i
);
let client = null;

// Needed to tell which server a channel is in.
function setClient(c) {
  client = c;
}

// Config class names may omit the PDF's "IT-" prefix.
const classMatches = (configured, className) =>
  className === configured || className === `IT-${configured}`;

// Classes (as configured) this server has timetable channels for.
function getGuildClassNames(guildId) {
  return getTimetableTargets()
    .filter(({ channelId }) => client?.channels.cache.get(channelId)?.guildId === guildId)
    .flatMap(({ classes }) => classes);
}

// Servers that follow this class.
function getGuildsForClass(className) {
  const guilds = new Set();
  for (const { channelId, classes } of getTimetableTargets()) {
    if (!classes.some((c) => classMatches(c, className))) continue;
    const guildId = client?.channels.cache.get(channelId)?.guildId;
    if (guildId) guilds.add(guildId);
  }
  return guilds;
}

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

// Today's and upcoming entries, sorted by date then time. Pass a className for
// one class, or { guildId } for every class that server follows.
function getUpcomingEntries({ className, guildId } = {}) {
  const today = todayKey();
  const followed = guildId ? getGuildClassNames(guildId) : null;
  return entries
    .filter((e) => e.date >= today)
    .filter((e) => !className || e.className === className)
    .filter((e) => !followed || followed.some((c) => classMatches(c, e.className)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

// The next school day after today (Friday -> Monday).
function nextSchoolDayKey() {
  const day = moment.tz(TZ).add(1, "day");
  while (day.isoWeekday() > 5) day.add(1, "day");
  return day.format("YYYY-MM-DD");
}

// Copy of `embed` with the "Manually Registered" sections for this server:
// today's cancellations, and the next school day's marked "(Upcoming)" so they
// show the day before. Later ones stay stored until then.
// Never mutates the input: the same embed is reused across channels.
function withManualEntries(embed, guildId) {
  if (!embed || !guildId) return embed;
  const entries = getUpcomingEntries({ guildId });
  const sections = [
    { date: todayKey(), title: "Manually Registered" },
    { date: nextSchoolDayKey(), title: "Manually Registered (Upcoming)" },
  ]
    .map((section) => ({ ...section, list: entries.filter((e) => e.date === section.date) }))
    .filter((section) => section.list.length);
  if (!sections.length) return embed;

  const copy = EmbedBuilder.from(embed.toJSON ? embed.toJSON() : embed);
  const room = Math.max(25 - (copy.data.fields?.length || 0), 0);
  copy.addFields(
    sections.slice(0, room).map(({ date, title, list }) => ({
      name: `${MANUAL_PREFIX} ${title} — ${moment.tz(date, "YYYY-MM-DD", TZ).format("dddd D MMMM")}`,
      value: list
        .map((e) => `**${e.className}** — ${e.module} \`${e.start}–${e.end}\``)
        .join("\n")
        .slice(0, 1024),
      inline: false,
    }))
  );
  return copy;
}

// Re-applies the manual section to the tracked Cancelled Lectures message in
// every server that follows this class, sending one if there is none yet.
async function refreshClassMessages(client, className) {
  const guilds = getGuildsForClass(className);
  for (const channelId of config.channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !guilds.has(channel.guildId)) continue;

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
      const embed = withManualEntries(base, channel.guildId);

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
  nextSchoolDayKey,
  refreshClassMessages,
  setClient,
};
