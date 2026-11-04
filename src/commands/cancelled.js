const { SlashCommandBuilder } = require("@discordjs/builders");
const {
  PermissionFlagsBits,
  ModalBuilder,
  LabelBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const moment = require("moment-timezone");
const config = require("../../config.json");
const { DAYS, getCachedTimetables } = require("../functions/fetchTimetable");
const {
  getTimetableTargets,
  resolveClassName,
  getTimetablesWithFallback,
} = require("../functions/timetableManager");
const {
  addEntry,
  removeEntry,
  getUpcomingEntries,
  refreshGuildMessages,
} = require("../functions/manualCancellations");

const TZ = "Europe/Malta";
// Component custom ids (routed from index.js).
const MODAL_PREFIX = "cancelled:"; // the lecture modal: cancelled:<class>|<week>
const CLASS_SELECT_ID = "cancelled-class"; // step 1: pick a class
const WEEK_BUTTON_PREFIX = "cancelled-week:"; // ◀ / ▶: cancelled-week:<class>|<week>
const isCancelledComponent = (id) =>
  id === CLASS_SELECT_ID || id.startsWith(MODAL_PREFIX) || id.startsWith(WEEK_BUTTON_PREFIX);
const MAX_OPTIONS = 25; // Discord's limit for a select menu

// MCAST semesters: 1 October – 31 January and 1 February – 31 May.
// The published timetable is for the current one, so dates stop at its end.
function currentSemester(now = moment.tz(TZ)) {
  const month = now.month(); // 0 = January
  const year = now.year();
  if (month >= 9) {
    return { name: "Semester 1", start: moment.tz([year, 9, 1], TZ), end: moment.tz([year + 1, 0, 31], TZ) };
  }
  if (month === 0) {
    return { name: "Semester 1", start: moment.tz([year - 1, 9, 1], TZ), end: moment.tz([year, 0, 31], TZ) };
  }
  if (month <= 4) {
    return { name: "Semester 2", start: moment.tz([year, 1, 1], TZ), end: moment.tz([year, 4, 31], TZ) };
  }
  return null; // June – September: no lectures
}

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

// Every lecture of the class from today until the end of the semester:
// [{ date: "YYYY-MM-DD", start, end, module, room }].
function getSessions(days, semester) {
  if (!semester) return [];
  const sessions = [];
  const today = moment.tz(TZ).startOf("day");
  const from = moment.max(today, semester.start);
  for (const date = from.clone(); date.isSameOrBefore(semester.end, "day"); date.add(1, "day")) {
    const weekday = date.format("dddd");
    if (!DAYS.includes(weekday)) continue;
    for (const l of days?.[weekday] || []) {
      sessions.push({
        date: date.format("YYYY-MM-DD"),
        start: l.start,
        end: l.end,
        module: l.module,
        room: l.room,
      });
    }
  }
  return sessions;
}

const weekOf = (date) => moment.tz(date, "YYYY-MM-DD", TZ).startOf("isoWeek").format("YYYY-MM-DD");
const sessionValue = (s) => `${s.date}|${s.start}`;

// Avoids a network round-trip when the timetable is already in memory; Discord
// only gives us 3 seconds to answer autocomplete or open a modal.
async function loadTimetables(client) {
  return getCachedTimetables() || getTimetablesWithFallback(client);
}

function canUse(interaction) {
  return (
    interaction.user.id === config.devId ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
  );
}

function weekLabel(weekStart) {
  const start = moment.tz(weekStart, "YYYY-MM-DD", TZ);
  const thisWeek = moment.tz(TZ).startOf("isoWeek");
  const suffix = start.isSame(thisWeek, "day")
    ? " (this week)"
    : start.isSame(thisWeek.clone().add(1, "week"), "day")
      ? " (next week)"
      : "";
  return `Week of Mon ${start.format("D MMM YYYY")}${suffix}`;
}

// Builds the lecture modal for one class and week (week defaults to the first
// week that still has lectures). Returns { modal } or { error }.
async function buildModal(interaction, className, requestedWeek) {
  const data = await loadTimetables(interaction.client);
  const classes = getGuildClasses(interaction.client, interaction.guildId, data.timetables);
  if (!classes.includes(className)) {
    return { error: `Class \`${className}\` has no timetable registered in this server.` };
  }

  const semester = currentSemester();
  if (!semester) return { error: "There's no semester running right now (June – September)." };

  const sessions = getSessions(data.timetables[className], semester);
  if (!sessions.length) {
    return { error: `\`${className}\` has no more lectures this ${semester.name.toLowerCase()}.` };
  }

  const week = requestedWeek ? weekOf(requestedWeek) : weekOf(sessions[0].date);
  const inWeek = sessions.filter((s) => weekOf(s.date) === week).slice(0, MAX_OPTIONS);
  if (!inWeek.length) {
    return { error: `\`${className}\` has no lectures left in the ${weekLabel(week).toLowerCase()}.` };
  }

  const registered = new Set(
    getUpcomingEntries(interaction.guildId)
      .filter((e) => e.className === className)
      .map(sessionValue)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("sessions")
    .setRequired(false)
    .setMinValues(0)
    .setMaxValues(inWeek.length)
    .setPlaceholder("Tick the cancelled lectures")
    .addOptions(
      inWeek.map((s) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(
            `${moment.tz(s.date, TZ).format("ddd D MMM")} · ${s.start}–${s.end} · ${s.module}`.slice(0, 100)
          )
          .setDescription((s.room ? `📍 ${s.room}` : "No room listed").slice(0, 100))
          .setValue(sessionValue(s))
          .setDefault(registered.has(sessionValue(s)))
      )
    );

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${className}|${week}`)
    .setTitle(`Cancelled — ${className}`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Cancelled lectures")
        .setDescription(`${weekLabel(week)}. Untick one to remove it.`.slice(0, 100))
        .setStringSelectMenuComponent(select)
    );
  return { modal };
}

// Opens the modal, or replies privately with why it can't.
async function openModal(interaction, className, week) {
  const { modal, error } = await buildModal(interaction, className, week);
  if (modal) return interaction.showModal(modal);
  return interaction.reply({ content: error, ephemeral: true });
}

// ◀ / ▶ buttons to open the modal for the neighbouring weeks of the semester.
function weekButtons(className, week, data) {
  const weeks = [
    ...new Set(getSessions(data.timetables[className], currentSemester()).map((s) => weekOf(s.date))),
  ];
  const i = weeks.indexOf(week);
  const button = (target, label) =>
    new ButtonBuilder()
      .setCustomId(`${WEEK_BUTTON_PREFIX}${className}|${target || week}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!target);
  return new ActionRowBuilder().addComponents(
    button(i > 0 ? weeks[i - 1] : null, "◀ Previous week"),
    button(i >= 0 && i < weeks.length - 1 ? weeks[i + 1] : null, "Next week ▶")
  );
}

module.exports = {
  isCancelledComponent,

  data: new SlashCommandBuilder()
    .setName("cancelled")
    .setDescription("Manually register cancelled lectures for this server")
    .addStringOption((o) =>
      o.setName("class").setDescription("The class, e.g. IT-SWD-6.1B (leave empty to pick from a list)").setAutocomplete(true)
    )
    .addStringOption((o) =>
      o.setName("week").setDescription("Which week (defaults to the next week with lectures)").setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused(true);
      const query = focused.value.toLowerCase();
      const data = await loadTimetables(interaction.client);
      const classes = getGuildClasses(interaction.client, interaction.guildId, data.timetables);
      let choices = [];

      if (focused.name === "class") {
        choices = classes.map((c) => ({ name: c, value: c }));
      } else if (focused.name === "week") {
        const className = interaction.options.getString("class");
        if (classes.includes(className)) {
          const weeks = [...new Set(getSessions(data.timetables[className], currentSemester()).map((s) => weekOf(s.date)))];
          choices = weeks.map((w) => ({ name: weekLabel(w), value: w }));
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

  // /cancelled class:X → straight to the modal.
  // /cancelled          → a class dropdown first (skipped if the server has one class).
  async execute(interaction) {
    const reply = (content) => interaction.reply({ content, ephemeral: true });
    if (!interaction.guildId) return reply("This command can only be used in a server.");
    if (!canUse(interaction)) {
      return reply("❌ You need the **Manage Messages** permission to register cancelled lectures.");
    }

    try {
      const className = interaction.options.getString("class");
      const week = interaction.options.getString("week");
      if (className) return await openModal(interaction, className, week);

      const data = await loadTimetables(interaction.client);
      const classes = getGuildClasses(interaction.client, interaction.guildId, data.timetables);
      if (classes.length === 0) return reply("This server has no class timetables registered.");
      if (classes.length === 1) return await openModal(interaction, classes[0], week);

      const select = new StringSelectMenuBuilder()
        .setCustomId(CLASS_SELECT_ID)
        .setPlaceholder("Pick a class")
        .addOptions(classes.slice(0, MAX_OPTIONS).map((c) => ({ label: c, value: c })));
      await interaction.reply({
        content: "Which class are the cancelled lectures for?",
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true,
      });
    } catch (error) {
      console.error("Error executing cancelled command:", error);
      if (!interaction.replied) {
        await reply("An error occurred while opening the cancelled lectures form.").catch(() => {});
      }
    }
  },

  // Class dropdown (step 1) and the ◀ / ▶ week buttons both open the modal.
  async handleComponent(interaction) {
    if (interaction.isModalSubmit()) return this.handleModal(interaction);
    if (!canUse(interaction)) {
      return interaction.reply({ content: "❌ You don't have permission to do that.", ephemeral: true });
    }
    try {
      if (interaction.customId === CLASS_SELECT_ID) {
        return await openModal(interaction, interaction.values[0]);
      }
      const [className, week] = interaction.customId.slice(WEEK_BUTTON_PREFIX.length).split("|");
      return await openModal(interaction, className, week);
    } catch (error) {
      console.error("Error opening cancelled lectures modal:", error);
      if (!interaction.replied) {
        await interaction
          .reply({ content: "An error occurred while opening the form.", ephemeral: true })
          .catch(() => {});
      }
    }
  },

  // The modal's selection becomes that week's set of cancellations for the class.
  async handleModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      if (!canUse(interaction)) {
        return interaction.editReply({ content: "❌ You don't have permission to do that." });
      }
      const [className, week] = interaction.customId.slice(MODAL_PREFIX.length).split("|");
      const data = await getTimetablesWithFallback(interaction.client);
      const classes = getGuildClasses(interaction.client, interaction.guildId, data.timetables);
      if (!classes.includes(className)) {
        return interaction.editReply({ content: `Class \`${className}\` has no timetable registered in this server.` });
      }

      // Same list the modal showed; only these can be added or removed.
      const offered = getSessions(data.timetables[className], currentSemester())
        .filter((s) => weekOf(s.date) === week)
        .slice(0, MAX_OPTIONS);
      const selected = new Set(interaction.fields.getStringSelectValues("sessions"));

      const added = [];
      const removed = [];
      for (const s of offered) {
        const entry = {
          guildId: interaction.guildId,
          className,
          module: s.module,
          date: s.date,
          start: s.start,
          end: s.end,
          room: s.room,
          addedBy: interaction.user.id,
        };
        const label = `${moment.tz(s.date, TZ).format("ddd D MMM")} \`${s.start}–${s.end}\` ${s.module}`;
        if (selected.has(sessionValue(s))) {
          if (addEntry(entry)) added.push(label);
        } else if (removeEntry(entry)) {
          removed.push(label);
        }
      }

      if (added.length || removed.length) {
        await refreshGuildMessages(interaction.client, interaction.guildId);
        console.log(
          `${interaction.user.tag} updated cancelled lectures for ${className} (${week}): +${added.length} -${removed.length}`
        );
      }

      const lines = [
        ...added.map((l) => `✅ ${l}`),
        ...removed.map((l) => `🗑️ ${l}`),
      ];
      await interaction.editReply({
        content: `**${className}** — ${weekLabel(week)}\n${lines.length ? lines.join("\n") : "No changes."}`,
        components: [weekButtons(className, week, data)],
      });
    } catch (error) {
      console.error("Error saving cancelled lectures:", error);
      await interaction.editReply({ content: "An error occurred while saving the cancelled lectures." });
    }
  },
};
