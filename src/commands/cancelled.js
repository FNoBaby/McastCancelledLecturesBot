const { SlashCommandBuilder } = require("@discordjs/builders");
const { PermissionFlagsBits } = require("discord.js");
const moment = require("moment-timezone");
const config = require("../../config.json");
const { DAYS } = require("../functions/fetchTimetable");
const {
  getTimetableTargets,
  resolveClassName,
  getTimetablesWithFallback,
} = require("../functions/timetableManager");
const {
  addEntry,
  removeEntry,
  refreshGuildMessages,
} = require("../functions/manualCancellations");

const TZ = "Europe/Malta";
const LOOKAHEAD_DAYS = 21;

// Only the classes this server has timetable channels for.
function getGuildClasses(client, guildId, timetables) {
  const classes = new Set();
  for (const { channelId, classes: configured } of getTimetableTargets()) {
    if (client.channels.cache.get(channelId)?.guildId !== guildId) continue;
    for (const name of configured) {
      const resolved = resolveClassName(name, timetables);
      if (resolved) classes.add(resolved);
    }
  }
  return [...classes].sort();
}

// Every lesson of `module` in the class's week, as [{ day, start, end, room }].
function findLessons(days, module) {
  return DAYS.flatMap((day) =>
    (days?.[day] || [])
      .filter((l) => l.module === module)
      .map((l) => ({ day, start: l.start, end: l.end, room: l.room }))
  );
}

// Upcoming dates (from today) on which `module` takes place.
function upcomingOccurrences(days, module) {
  const lessons = findLessons(days, module);
  const out = [];
  const today = moment.tz(TZ).startOf("day");
  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
    const date = today.clone().add(i, "days");
    for (const l of lessons.filter((x) => x.day === date.format("dddd"))) {
      out.push({ ...l, date: date.format("YYYY-MM-DD") });
    }
  }
  return out;
}

// Accepts the autocomplete value ("2026-11-05|09:00") or a typed date.
function parseDateInput(input) {
  const [datePart, start] = input.trim().split("|");
  const formats = ["YYYY-MM-DD", "D MMMM YYYY", "D MMM YYYY"];
  for (const sep of ["/", "-", "."]) {
    for (const d of ["D", "DD"]) {
      for (const m of ["M", "MM"]) formats.push(`${d}${sep}${m}${sep}YYYY`, `${d}${sep}${m}`);
    }
  }
  const date = moment.tz(datePart, formats, true, TZ);
  return date.isValid() ? { date, start: start || null } : null;
}

function canUse(interaction) {
  return (
    interaction.user.id === config.devId ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cancelled")
    .setDescription("Manually register a cancelled lecture for this server")
    .addStringOption((o) =>
      o.setName("class").setDescription("The class, e.g. IT-SWD-6.1B").setRequired(true).setAutocomplete(true)
    )
    .addStringOption((o) =>
      o.setName("lecture").setDescription("The lecture from that class's timetable").setRequired(true).setAutocomplete(true)
    )
    .addStringOption((o) =>
      o.setName("date").setDescription("When it's cancelled (pick one, or type e.g. 05/11/2026)").setRequired(true).setAutocomplete(true)
    )
    .addBooleanOption((o) =>
      o.setName("remove").setDescription("Remove this cancellation instead of adding it")
    ),

  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused(true);
      const query = focused.value.toLowerCase();
      const data = await getTimetablesWithFallback(interaction.client);
      const classes = getGuildClasses(interaction.client, interaction.guildId, data.timetables);
      let choices = [];

      if (focused.name === "class") {
        choices = classes.map((c) => ({ name: c, value: c }));
      } else {
        const className = interaction.options.getString("class");
        const days = classes.includes(className) ? data.timetables[className] : null;
        if (days && focused.name === "lecture") {
          const modules = new Map(); // module -> days it's on
          for (const day of DAYS) {
            for (const l of days[day] || []) {
              if (!modules.has(l.module)) modules.set(l.module, new Set());
              modules.get(l.module).add(day.slice(0, 3));
            }
          }
          choices = [...modules].map(([module, on]) => ({
            name: `${module} (${[...on].join(", ")})`.slice(0, 100),
            value: module.slice(0, 100),
          }));
        } else if (days && focused.name === "date") {
          const module = interaction.options.getString("lecture");
          choices = upcomingOccurrences(days, module).map((o) => ({
            name: `${moment.tz(o.date, TZ).format("ddd D MMM YYYY")} · ${o.start}–${o.end}${o.room ? ` · ${o.room}` : ""}`.slice(0, 100),
            value: `${o.date}|${o.start}`,
          }));
        }
      }

      await interaction.respond(
        choices.filter((c) => c.name.toLowerCase().includes(query)).slice(0, 25)
      );
    } catch (error) {
      console.error("Cancelled autocomplete failed:", error);
      await interaction.respond([]).catch(() => {});
    }
  },

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    }
    if (!canUse(interaction)) {
      return interaction.reply({
        content: "❌ You need the **Manage Messages** permission to register cancelled lectures.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const className = interaction.options.getString("class");
      const module = interaction.options.getString("lecture");
      const remove = interaction.options.getBoolean("remove") || false;
      const parsed = parseDateInput(interaction.options.getString("date"));

      const data = await getTimetablesWithFallback(interaction.client);
      const classes = getGuildClasses(interaction.client, interaction.guildId, data.timetables);
      if (!classes.includes(className)) {
        return interaction.editReply({
          content: `Class \`${className}\` has no timetable registered in this server.`,
        });
      }
      const days = data.timetables[className];
      if (!findLessons(days, module).length) {
        return interaction.editReply({
          content: `\`${module}\` isn't on the timetable for \`${className}\`.`,
        });
      }
      if (!parsed) {
        return interaction.editReply({
          content: "I couldn't read that date. Pick one from the list, or type it like `05/11/2026`.",
        });
      }
      if (!remove && parsed.date.isBefore(moment.tz(TZ).startOf("day"))) {
        return interaction.editReply({ content: "That date is in the past." });
      }

      // Times come from the timetable for that weekday.
      const weekday = parsed.date.format("dddd");
      const lessons = findLessons(days, module).filter(
        (l) => l.day === weekday && (!parsed.start || l.start === parsed.start)
      );
      const dateText = parsed.date.format("dddd D MMMM YYYY");
      if (!lessons.length) {
        return interaction.editReply({
          content: `\`${className}\` has no \`${module}\` lecture on ${dateText}.`,
        });
      }

      const date = parsed.date.format("YYYY-MM-DD");
      const results = lessons.map((l) => {
        const entry = {
          guildId: interaction.guildId,
          className,
          module,
          date,
          start: l.start,
          end: l.end,
          room: l.room,
          addedBy: interaction.user.id,
        };
        const time = `\`${l.start}–${l.end}\``;
        if (remove) {
          return removeEntry(entry) ? `🗑️ Removed ${time}` : `ℹ️ ${time} wasn't registered`;
        }
        return addEntry(entry) ? `✅ Registered ${time}` : `ℹ️ ${time} was already registered`;
      });

      await refreshGuildMessages(interaction.client, interaction.guildId);

      console.log(
        `${interaction.user.tag} ${remove ? "removed" : "registered"} cancelled lecture: ${className} ${module} ${date}`
      );
      await interaction.editReply({
        content: `**${className}** — ${module}, ${dateText}\n${results.join("\n")}`,
      });
    } catch (error) {
      console.error("Error executing cancelled command:", error);
      await interaction.editReply({
        content: "An error occurred while registering the cancelled lecture.",
      });
    }
  },
};
