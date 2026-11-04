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
  refreshClassMessages,
  nextSchoolDayKey,
} = require("../functions/manualCancellations");

const TZ = "Europe/Malta";
// Component custom ids (routed from index.js).
const MODAL_PREFIX = "cancelled:"; // the lecture modal: cancelled:<class>|<week>
const CLASS_SELECT_ID = "cancelled-class"; // step 1: pick a class
const WEEK_SELECT_PREFIX = "cancelled-weeks:"; // step 2: pick a week, cancelled-weeks:<class>
const WEEK_BUTTON_PREFIX = "cancelled-week:"; // Edit this week: cancelled-week:<class>|<week>
const UNDO_PREFIX = "cancelled-undo:"; // cancelled-undo:<add|remove>|<class>|<date>|<start>
const isCancelledComponent = (id) =>
  id === CLASS_SELECT_ID ||
  [MODAL_PREFIX, WEEK_SELECT_PREFIX, WEEK_BUTTON_PREFIX, UNDO_PREFIX].some((p) => id.startsWith(p));
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

const sessionLabel = (s) =>
  `${moment.tz(s.date, TZ).format("ddd D MMM")} · ${s.start}–${s.end} · ${s.module}`;

// Every word typed must appear somewhere, so "databases 12 nov" works.
const matchesQuery = (text, query) => {
  const haystack = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => haystack.includes(w));
};

const weekOf = (date) => moment.tz(date, "YYYY-MM-DD", TZ).startOf("isoWeek").format("YYYY-MM-DD");
const sessionValue = (s) => `${s.date}|${s.start}`;

const toEntry = (interaction, className, s) => ({
  guildId: interaction.guildId, // which server registered it (for the log)
  className,
  module: s.module,
  date: s.date,
  start: s.start,
  end: s.end,
  room: s.room,
  addedBy: interaction.user.id,
});

const changeLabel = (s) =>
  `${moment.tz(s.date, TZ).format("ddd D MMM")} \`${s.start}–${s.end}\` ${s.module}`;

// Registers ("add") or removes ("remove") one lecture and updates every server
// following the class. Returns false if nothing changed.
async function applyChange(interaction, className, session, action) {
  const entry = toEntry(interaction, className, session);
  const changed = action === "add" ? addEntry(entry) : removeEntry(entry) > 0;
  if (changed) {
    await refreshClassMessages(interaction.client, className);
    console.log(
      `${interaction.user.tag} in "${interaction.guild?.name}" (${interaction.guildId}) ${action === "add" ? "registered" : "removed"} cancelled lecture: ${className} ${session.module} ${session.date} ${session.start}`
    );
  }
  return changed;
}

// Reply after a single search change: what happened, plus Undo and Edit this week.
function singleChangeReply(className, session, action, changed) {
  const later = action === "add" && session.date > nextSchoolDayKey();
  const text = changed
    ? `${action === "add" ? "✅ Registered" : "🗑️ Removed"} **${className}** — ${changeLabel(session)}` +
      (later ? "\n*It will show in Cancelled Lectures the day before.*" : "")
    : `ℹ️ **${className}** — ${changeLabel(session)} was ${action === "add" ? "already registered" : "not registered"}.`;
  const buttons = [];
  if (changed) {
    const reverse = action === "add" ? "remove" : "add";
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${UNDO_PREFIX}${reverse}|${className}|${session.date}|${session.start}`)
        .setLabel("Undo")
        .setStyle(ButtonStyle.Danger)
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`${WEEK_BUTTON_PREFIX}${className}|${weekOf(session.date)}`)
      .setLabel("Edit this week")
      .setStyle(ButtonStyle.Secondary)
  );
  return { content: text, components: [new ActionRowBuilder().addComponents(buttons)] };
}

// Finds one lecture of the class this semester by its "date|start" value.
async function findSession(interaction, className, value) {
  const data = await getTimetablesWithFallback(interaction.client);
  const classes = getGuildClasses(interaction.client, interaction.guildId, data.timetables);
  if (!classes.includes(className)) return null;
  return getSessions(data.timetables[className], currentSemester()).find((s) => sessionValue(s) === value) || null;
}

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
// week that still has lectures). `preselect` is a session value to tick, e.g.
// one picked through the lecture search. Returns { modal } or { error }.
async function buildModal(interaction, className, requestedWeek, preselect = null) {
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

  // Shared across every server that follows this class.
  const registered = new Set(getUpcomingEntries({ className }).map(sessionValue));

  const select = new StringSelectMenuBuilder()
    .setCustomId("sessions")
    .setRequired(false)
    .setMinValues(0)
    .setMaxValues(inWeek.length)
    .setPlaceholder("Tick the cancelled lectures")
    .addOptions(
      inWeek.map((s) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(sessionLabel(s).slice(0, 100))
          .setDescription((s.room ? `📍 ${s.room}` : "No room listed").slice(0, 100))
          .setValue(sessionValue(s))
          .setDefault(registered.has(sessionValue(s)) || sessionValue(s) === preselect)
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
async function openModal(interaction, className, week, preselect) {
  const { modal, error } = await buildModal(interaction, className, week, preselect);
  if (modal) return interaction.showModal(modal);
  return interaction.reply({ content: error, ephemeral: true });
}

// Step 2: a dropdown of every week left in the semester, with how many lectures
// each has and how many are already registered as cancelled.
async function weekSelectMessage(interaction, className) {
  const data = await loadTimetables(interaction.client);
  const sessions = getSessions(data.timetables[className], currentSemester());
  if (!sessions.length) {
    return { content: `\`${className}\` has no more lectures this semester.`, components: [] };
  }
  const registered = new Set(getUpcomingEntries({ className }).map(sessionValue));
  const weeks = new Map(); // week -> { total, cancelled }
  for (const s of sessions) {
    const w = weekOf(s.date);
    const count = weeks.get(w) || { total: 0, cancelled: 0 };
    count.total++;
    if (registered.has(sessionValue(s))) count.cancelled++;
    weeks.set(w, count);
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${WEEK_SELECT_PREFIX}${className}`)
    .setPlaceholder("Pick a week")
    .addOptions(
      [...weeks].slice(0, MAX_OPTIONS).map(([w, { total, cancelled }]) => ({
        label: weekLabel(w),
        description: `${total} lecture${total === 1 ? "" : "s"}` + (cancelled ? ` · ${cancelled} cancelled` : ""),
        value: w,
      }))
    );
  return {
    content:
      `**${className}**: which week? ` +
      "*(Tip: `/cancelled class:… lecture:…` searches the whole semester and registers one lecture right away.)*",
    components: [new ActionRowBuilder().addComponents(select)],
  };
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
      o.setName("lecture").setDescription("Search a lecture to cancel it right away (or un-cancel it), e.g. \"databases 12 nov\"").setAutocomplete(true)
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

      const className = interaction.options.getString("class");
      const sessions = classes.includes(className)
        ? getSessions(data.timetables[className], currentSemester())
        : [];

      if (focused.name === "class") {
        choices = classes.map((c) => ({ name: c, value: c }));
      } else if (focused.name === "week") {
        const weeks = [...new Set(sessions.map((s) => weekOf(s.date)))];
        choices = weeks.map((w) => ({ name: weekLabel(w), value: w }));
      } else if (focused.name === "lecture") {
        // Searches every lecture until the end of the semester. The day name and
        // full month are searchable too ("thursday", "november").
        // Already-registered ones are marked; picking them removes the cancellation.
        const registered = new Set(getUpcomingEntries({ className }).map(sessionValue));
        choices = sessions.map((s) => {
          const isCancelled = registered.has(sessionValue(s));
          const name = isCancelled
            ? `✅ ${sessionLabel(s)} (cancelled, pick to remove)`
            : `${sessionLabel(s)}${s.room ? ` · ${s.room}` : ""}`;
          return {
            name: name.slice(0, 100),
            value: sessionValue(s),
            search: `${sessionLabel(s)} ${s.room} ${moment.tz(s.date, TZ).format("dddd MMMM")}${isCancelled ? " cancelled" : ""}`,
          };
        });
      }

      await interaction.respond(
        choices
          .filter((c) => matchesQuery(c.search || c.name, query))
          .slice(0, 25)
          .map(({ name, value }) => ({ name, value }))
      );
    } catch (error) {
      console.error("Cancelled autocomplete failed:", error);
      await interaction.respond([]).catch(() => {});
    }
  },

  // /cancelled class:X lecture:Y → registers Y right away (or removes it if already registered).
  // /cancelled class:X           → straight to the modal (current week, or week:).
  // /cancelled                   → class dropdown → week dropdown → modal
  //                                (class step skipped if the server has one class).
  async execute(interaction) {
    const reply = (content) => interaction.reply({ content, ephemeral: true });
    if (!interaction.guildId) return reply("This command can only be used in a server.");
    if (!canUse(interaction)) {
      return reply("❌ You need the **Manage Messages** permission to register cancelled lectures.");
    }

    try {
      const className = interaction.options.getString("class");
      const week = interaction.options.getString("week");
      const lecture = interaction.options.getString("lecture");
      if (lecture) {
        if (!className) return reply("Pick a `class` first, then search for the `lecture`.");
        if (!/^\d{4}-\d{2}-\d{2}\|\d{2}:\d{2}$/.test(lecture)) {
          return reply("Pick a lecture from the search results.");
        }
        // Search pick: register straight away, or remove it if it's already registered.
        await interaction.deferReply({ ephemeral: true });
        const session = await findSession(interaction, className, lecture);
        if (!session) {
          return interaction.editReply({ content: "That lecture isn't on this server's timetable for this semester." });
        }
        const registered = getUpcomingEntries({ className }).some((e) => sessionValue(e) === lecture);
        const action = registered ? "remove" : "add";
        const changed = await applyChange(interaction, className, session, action);
        return interaction.editReply(singleChangeReply(className, session, action, changed));
      }
      if (className) return await openModal(interaction, className, week);

      const data = await loadTimetables(interaction.client);
      const classes = getGuildClasses(interaction.client, interaction.guildId, data.timetables);
      if (classes.length === 0) return reply("This server has no class timetables registered.");
      if (classes.length === 1) {
        if (week) return await openModal(interaction, classes[0], week);
        return await interaction.reply({ ...(await weekSelectMessage(interaction, classes[0])), ephemeral: true });
      }

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
      if (!interaction.replied && !interaction.deferred) {
        await reply("An error occurred while opening the cancelled lectures form.").catch(() => {});
      } else {
        await interaction.editReply({ content: "An error occurred while registering the cancelled lecture." }).catch(() => {});
      }
    }
  },

  // Class dropdown (step 1) → week dropdown (step 2) → modal; also Undo and Edit this week.
  async handleComponent(interaction) {
    if (interaction.isModalSubmit()) return this.handleModal(interaction);
    if (!canUse(interaction)) {
      return interaction.reply({ content: "❌ You don't have permission to do that.", ephemeral: true });
    }
    try {
      if (interaction.customId === CLASS_SELECT_ID) {
        return await interaction.update(await weekSelectMessage(interaction, interaction.values[0]));
      }
      if (interaction.customId.startsWith(UNDO_PREFIX)) {
        await interaction.deferUpdate();
        const [action, className, date, start] = interaction.customId.slice(UNDO_PREFIX.length).split("|");
        const session = await findSession(interaction, className, `${date}|${start}`);
        if (!session) return interaction.editReply({ content: "That lecture is no longer on the timetable.", components: [] });
        const changed = await applyChange(interaction, className, session, action);
        // Undo of an undo works too: the reply flips to the opposite action.
        return interaction.editReply(singleChangeReply(className, session, action, changed));
      }
      if (interaction.customId.startsWith(WEEK_SELECT_PREFIX)) {
        const className = interaction.customId.slice(WEEK_SELECT_PREFIX.length);
        return await openModal(interaction, className, interaction.values[0]);
      }
      const [className, week] = interaction.customId.slice(WEEK_BUTTON_PREFIX.length).split("|");
      return await openModal(interaction, className, week);
    } catch (error) {
      console.error("Error handling cancelled lectures component:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: "An error occurred while opening the form.", ephemeral: true })
          .catch(() => {});
      }
    }
  },

  // The modal's selection becomes that week's set of cancellations for the class.
  // If the modal was opened from a message (week dropdown, Edit this week), that
  // message is updated in place; from /cancelled class:X there is none, so we reply.
  async handleModal(interaction) {
    const fromMessage = interaction.isFromMessage();
    if (fromMessage) await interaction.deferUpdate();
    else await interaction.deferReply({ ephemeral: true });
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
        const entry = toEntry(interaction, className, s);
        const label = changeLabel(s);
        if (selected.has(sessionValue(s))) {
          if (addEntry(entry)) added.push(label);
        } else if (removeEntry(entry)) {
          removed.push(label);
        }
      }

      if (added.length || removed.length) {
        await refreshClassMessages(interaction.client, className);
        console.log(
          `${interaction.user.tag} in "${interaction.guild?.name}" (${interaction.guildId}) updated cancelled lectures for ${className} (${week}): +${added.length} -${removed.length}`
        );
      }

      const lines = [
        ...added.map((l) => `✅ ${l}`),
        ...removed.map((l) => `🗑️ ${l}`),
      ];
      const result =
        `**${className}** — ${weekLabel(week)}\n${lines.length ? lines.join("\n") : "No changes."}` +
        (added.length && offered.some((s) => s.date > nextSchoolDayKey())
          ? "\n*Cancelled Lectures shows each one from the day before.*"
          : "");

      // From a message, this replaces it (dropdown/buttons removed).
      await interaction.editReply({ content: result, components: [] });
    } catch (error) {
      console.error("Error saving cancelled lectures:", error);
      await interaction.editReply({ content: "An error occurred while saving the cancelled lectures." });
    }
  },
};
