const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const { EmbedBuilder } = require("discord.js");

const BASE_URL = "https://iict.mcast.edu.mt";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DEFAULT_CLASSES = ["IT-SWD-6.1B", "IT-SWD-6.2B"];

let cache = null; // { url, hash, createdOn, classes, timetables }

// The menu item id changes between WordPress rebuilds, so match on the link text.
async function findTimetableUrl() {
  const { data } = await axios.get(BASE_URL, { timeout: 30000 });
  const $ = cheerio.load(data);
  let href = null;
  $("li a, a").each((_, el) => {
    const text = $(el).text();
    const link = $(el).attr("href");
    if (/timetable/i.test(text) && link && /\.pdf(\?|$)/i.test(link)) {
      href = new URL(link, BASE_URL).toString();
      return false;
    }
  });
  return href;
}

const pad = (n) => String(n).padStart(2, "0");

function parseTime(label) {
  const [h, m] = label.split(":").map(Number);
  return `${pad(h)}:${pad(m)}`;
}

// Turn one PDF page (a day x 30-minute grid) into { className, days: {Monday: [lessons]} }.
async function parsePage(page, OPS) {
  const text = (await page.getTextContent()).items
    .filter((i) => i.str.trim())
    .map((i) => ({
      str: i.str.trim(),
      x: i.transform[4],
      y: i.transform[5],
      w: i.width,
    }));

  const timeLabels = text
    .filter((t) => /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(t.str))
    .sort((a, b) => b.y - a.y);
  const className = text.find(
    (t) => t.y > 495 && t.y < 510 && !DAYS.includes(t.str)
  )?.str;
  if (!className || timeLabels.length === 0) return null;

  // Walk the drawing operators, remembering the current fill colour.
  const ops = await page.getOperatorList();
  let fill = [0, 0, 0];
  const rects = [];
  ops.fnArray.forEach((fn, i) => {
    const args = ops.argsArray[i];
    if (fn === OPS.setFillRGBColor) {
      fill = [args[0], args[1], args[2]];
    } else if (fn === OPS.constructPath && args[1].length === 4) {
      const [x, y, w, h] = args[1];
      rects.push({ x, y, w, h, fill });
    }
  });

  // Row boundaries come from the thin horizontal rules. The first rule under the
  // day headers is the top of the first row, so N time labels give N + 1 rules.
  const rowLines = rects
    .filter((r) => r.h < 1 && r.w > 30 && r.y < 483 && r.y > 80)
    .map((r) => r.y)
    .sort((a, b) => b - a)
    .filter((y, i, arr) => i === 0 || arr[i - 1] - y > 5);
  const gridTop = rowLines[0];
  // Column boundaries come from the tall thin vertical rules (plus the time column edge).
  const colLines = rects
    .filter((r) => r.w < 2 && r.h > 300)
    .map((r) => r.x)
    .sort((a, b) => a - b)
    .filter((x, i, arr) => i === 0 || x - arr[i - 1] > 5);
  const gridLeft = rects.find((r) => r.w < 1 && r.h > 400 && r.x > 90 && r.x < 100)?.x;
  const colEdges = [gridLeft ?? 95, ...colLines.filter((x) => x > 100)];

  const lessons = {};
  const boxes = rects.filter(
    (r) =>
      r.h > 10 &&
      r.w > 30 &&
      r.x > 95 &&
      r.y + r.h <= gridTop + 2 &&
      !(r.fill[0] === 255 && r.fill[1] === 255 && r.fill[2] === 255) &&
      !(r.fill[0] === 0 && r.fill[1] === 0 && r.fill[2] === 0)
  );

  for (const box of boxes) {
    const cx = box.x + box.w / 2;
    const dayIdx = colEdges.findIndex(
      (edge, i) => i < colEdges.length - 1 && cx >= edge && cx < colEdges[i + 1]
    );
    if (dayIdx < 0 || dayIdx >= DAYS.length) continue;

    // Nearest row lines to the top and bottom of the box.
    const nearest = (y) =>
      rowLines.reduce(
        (best, line, idx) =>
          Math.abs(line - y) < Math.abs(rowLines[best] - y) ? idx : best,
        0
      );
    const topLine = nearest(box.y + box.h);
    const bottomLine = nearest(box.y);
    const first = timeLabels[topLine];
    const last = timeLabels[Math.max(bottomLine - 1, topLine)];
    if (!first || !last) continue;

    const inside = text
      .filter(
        (t) =>
          t.x + t.w / 2 >= box.x - 2 &&
          t.x + t.w / 2 <= box.x + box.w + 2 &&
          t.y >= box.y - 2 &&
          t.y <= box.y + box.h + 2
      )
      .sort((a, b) => b.y - a.y || a.x - b.x);
    if (inside.length === 0) continue;

    const room = inside.length > 1 ? inside[inside.length - 1].str : "";
    const moduleParts = inside.length > 1 ? inside.slice(0, -1) : inside;
    const fullModule = moduleParts.map((t) => t.str).join(" ");
    const m = fullModule.match(/^([A-Z]+-\d+-\d+)-(.+)$/);

    const day = DAYS[dayIdx];
    (lessons[day] = lessons[day] || []).push({
      start: parseTime(first.str.split("-")[0].trim()),
      end: parseTime(last.str.split("-")[1].trim()),
      code: m ? m[1] : "",
      module: m ? m[2] : fullModule,
      room,
    });
  }

  for (const day of Object.keys(lessons)) {
    lessons[day].sort((a, b) => a.start.localeCompare(b.start));
  }

  const createdOn = text.find((t) => /^Created on /i.test(t.str))?.str || null;
  return { className, days: lessons, createdOn };
}

async function parseTimetablePdf(buffer) {
  // pdfjs warns about missing optional `canvas` (only needed for rendering)
  // (pdfjs prints these via console.log, so mute both)
  const origWarn = console.warn;
  const origLog = console.log;
  const quiet = (orig) => (...a) => {
    if (!String(a[0]).includes("Cannot polyfill")) orig(...a);
  };
  console.warn = quiet(origWarn);
  console.log = quiet(origLog);
  let pdfjs;
  try {
    pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
  } finally {
    console.warn = origWarn;
    console.log = origLog;
  }
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
  }).promise;

  const timetables = {};
  let createdOn = null;
  for (let p = 1; p <= doc.numPages; p++) {
    const parsed = await parsePage(await doc.getPage(p), pdfjs.OPS);
    if (!parsed) continue;
    timetables[parsed.className] = parsed.days;
    createdOn = createdOn || parsed.createdOn;
  }
  return { timetables, createdOn };
}

// Fetches the current timetable PDF. Returns cached data unless the PDF changed.
async function getTimetables() {
  const url = await findTimetableUrl();
  if (!url) throw new Error('No "Timetable" link found on the IICT site.');

  const { data } = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
  });
  const buffer = Buffer.from(data);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (cache && cache.hash === hash) return { ...cache, changed: false };

  const { timetables, createdOn } = await parseTimetablePdf(buffer);
  cache = {
    url,
    hash,
    createdOn,
    timetables,
    classes: Object.keys(timetables).sort(),
  };
  return { ...cache, changed: true };
}

// Class list for autocomplete; only hits the network if nothing is cached yet.
async function getClassList() {
  if (cache) return cache.classes;
  return (await getTimetables()).classes;
}

function buildTimetableEmbed(className, days, meta = {}) {
  const embed = new EmbedBuilder()
    .setTitle(`Timetable — ${className}`)
    .setColor("Blue");
  if (meta.url) embed.setURL(meta.url);

  for (const day of DAYS) {
    const lessons = days?.[day] || [];
    const value = lessons.length
      ? lessons
          .map(
            (l) =>
              `• **${l.start}–${l.end}** ${l.module}${l.room ? ` — ${l.room}` : ""}`
          )
          .join("\n")
      : "• No lessons";
    embed.addFields({ name: day, value: value.slice(0, 1024), inline: false });
  }
  if (meta.createdOn) embed.setFooter({ text: meta.createdOn });
  return embed;
}

module.exports = {
  DEFAULT_CLASSES,
  DAYS,
  findTimetableUrl,
  parseTimetablePdf,
  getTimetables,
  getClassList,
  buildTimetableEmbed,
};
