const { SlashCommandBuilder } = require("@discordjs/builders");
const config = require("../../config.json");
const {
  getTimetables,
  getClassList,
  buildTimetableEmbed,
} = require("../functions/fetchTimetable");
const { syncTimetableMessages } = require("../functions/timetableManager");

const cooldowns = new Map();
const COOLDOWN_MS = 10 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("timetable")
    .setDescription("DM yourself the timetable of a class")
    .addStringOption((option) =>
      option
        .setName("class")
        .setDescription("The class, e.g. IT-SWD-6.1B")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    try {
      const classes = await getClassList();
      await interaction.respond(
        classes
          .filter((c) => c.toLowerCase().includes(focused))
          .slice(0, 25)
          .map((c) => ({ name: c, value: c }))
      );
    } catch (error) {
      console.error("Timetable autocomplete failed:", error);
      await interaction.respond([]).catch(() => {});
    }
  },

  async execute(interaction) {
    const userId = interaction.user.id;
    if (userId !== config.devId) {
      const last = cooldowns.get(userId) || 0;
      const left = last + COOLDOWN_MS - Date.now();
      if (left > 0) {
        return interaction.reply({
          content: `Please wait ${(left / 1000).toFixed(1)} more seconds before reusing \`/timetable\`.`,
          ephemeral: true,
        });
      }
      cooldowns.set(userId, Date.now());
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const className = interaction.options.getString("class");
      const data = await getTimetables();
      const days = data.timetables[className];
      if (!days) {
        return interaction.editReply({
          content: `Class \`${className}\` was not found in the current timetable.`,
        });
      }

      const embed = buildTimetableEmbed(className, days, data);
      let dmSent = true;
      try {
        await interaction.user.send({ embeds: [embed] });
      } catch (error) {
        dmSent = false;
      }

      // Keep the shared timetable messages fresh whenever someone asks.
      syncTimetableMessages(interaction.client, { force: true });

      if (dmSent) {
        await interaction.editReply({
          content: `Sent the timetable for \`${className}\` to your DMs.`,
        });
      } else {
        await interaction.editReply({
          content: "I couldn't DM you (are your DMs closed?), so here it is:",
          embeds: [embed],
        });
      }
    } catch (error) {
      console.error("Error executing timetable command:", error);
      await interaction.editReply({
        content: "An error occurred while fetching the timetable.",
      });
    }
  },
};
