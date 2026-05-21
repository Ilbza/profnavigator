#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";

const root = path.resolve(process.cwd());
const dbPath = path.join(root, "data", "programs-db.js");

const SUBJECT_MAP = {
  "русский язык": "russian",
  "математика": "math",
  "математика профильного уровня": "math",
  "информатика": "informatics",
  "информатика и икт": "informatics",
  "физика": "physics",
  "химия": "chemistry",
  "биология": "biology",
  "обществознание": "social",
  "история": "history",
  "литература": "literature",
  "английский язык": "english",
  "иностранный язык": "english"
};

const INTERESTS_BY_TRACK = {
  tech: ["tech", "engineering"],
  economics: ["economics", "communication"],
  law: ["law", "communication"],
  social: ["communication", "health"],
  creative: ["creative", "communication"],
  engineering: ["engineering", "tech"]
};

const SOURCE_SEEDS = {
  mai_2026_2025: [
    {
      direction: "Программная инженерия",
      university: "МАИ",
      city: "Москва",
      region: "Москва",
      required: ["math", "informatics", "russian"],
      thresholdBudget: 93,
      thresholdPaid: 60,
      interests: ["tech", "engineering"],
      sourceId: "mai_2026_2025",
      note: "Резервная запись: ориентир бюджета из проходного 2025."
    },
    {
      direction: "Информатика и вычислительная техника",
      university: "МАИ",
      city: "Москва",
      region: "Москва",
      required: ["math", "informatics", "russian"],
      thresholdBudget: 87,
      thresholdPaid: 60,
      interests: ["tech", "engineering"],
      sourceId: "mai_2026_2025",
      note: "Резервная запись: ориентир бюджета из проходного 2025."
    }
  ],
  ranepa_spb_2026: [
    {
      direction: "Экономика",
      university: "РАНХиГС Санкт-Петербург",
      city: "Санкт-Петербург",
      region: "Санкт-Петербург",
      required: ["math", "social", "russian"],
      thresholdBudget: 78,
      thresholdPaid: 60,
      interests: ["economics", "communication"],
      sourceId: "ranepa_spb_2026",
      note: "Резервная запись: ориентир рассчитан по опубликованной таблице приема."
    },
    {
      direction: "Менеджмент",
      university: "РАНХиГС Санкт-Петербург",
      city: "Санкт-Петербург",
      region: "Санкт-Петербург",
      required: ["math", "social", "russian"],
      thresholdBudget: 77,
      thresholdPaid: 60,
      interests: ["economics", "communication"],
      sourceId: "ranepa_spb_2026",
      note: "Резервная запись: ориентир рассчитан по опубликованной таблице приема."
    }
  ]
};

function toJsFile(dbObj) {
  return `window.PROFORIENT_DB = ${JSON.stringify(dbObj, null, 2)};\n`;
}

function fromJsFile(raw) {
  const body = raw.replace(/^window\.PROFORIENT_DB\s*=\s*/, "").replace(/;\s*$/, "");
  return vm.runInNewContext(`(${body})`);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ProfNavigatorBot/1.0"
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return await res.text();
}

function detectTrack(direction) {
  const d = direction.toLowerCase();
  if (/(информ|программ|данных|ai|искусственн|безопасн)/.test(d)) return "tech";
  if (/(эконом|бизнес|менедж|финанс)/.test(d)) return "economics";
  if (/(прав|государствен|муниципал)/.test(d)) return "law";
  if (/(психолог|социолог|коммуник)/.test(d)) return "social";
  if (/(дизайн|архитект|творч)/.test(d)) return "creative";
  if (/(инжен|технолог|машин|авиа)/.test(d)) return "engineering";
  return "social";
}

function normalizeSubject(raw) {
  const text = raw.toLowerCase().replace(/\s+/g, " ").trim();
  return SUBJECT_MAP[text] || null;
}

function pickRequiredFromText(text) {
  const found = new Set();
  const normalized = text.toLowerCase();
  Object.keys(SUBJECT_MAP).forEach((k) => {
    if (normalized.includes(k)) {
      const mapped = SUBJECT_MAP[k];
      if (mapped) found.add(mapped);
    }
  });
  const required = Array.from(found).slice(0, 3);
  while (required.length < 3) required.push("russian");
  return required.slice(0, 3);
}

function estimateThresholdByText(fragment, fallback = 60) {
  const nums = [...fragment.matchAll(/\b(\d{2,3})\b/g)].map((m) => Number(m[1])).filter((n) => n >= 40 && n <= 100);
  if (!nums.length) return fallback;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

async function parseHseSpb(source) {
  const text = await fetchText(source.url);
  const chunks = text.split(/Направление подготовки/gi).slice(1);
  const out = [];

  for (const chunk of chunks) {
    const programMatches = [...chunk.matchAll(/>([^<>]{4,120})<\/a>/g)].map((m) => m[1].trim());
    const numericThreshold = estimateThresholdByText(chunk, 60);

    for (const title of programMatches.slice(0, 4)) {
      const required = pickRequiredFromText(chunk);
      const track = detectTrack(title);
      out.push({
        direction: title,
        university: "НИУ ВШЭ - Санкт-Петербург",
        city: "Санкт-Петербург",
        region: "Санкт-Петербург",
        required,
        thresholdBudget: Math.max(60, numericThreshold),
        thresholdPaid: 60,
        interests: INTERESTS_BY_TRACK[track],
        sourceId: source.id
      });
    }
  }

  return uniquePrograms(out).slice(0, 25);
}

async function parseMai(source) {
  const text = await fetchText(source.url);
  const compact = text.replace(/\s+/g, " ");
  const out = [];

  const re = /(\d{2}\.\d{2}\.\d{2})\s*\(БВО\)\s*([^0-9]{4,120}?)\s+(\d{3})/g;
  let match;
  while ((match = re.exec(compact)) !== null) {
    const direction = match[2].replace(/\s+/g, " ").trim();
    const total = Number(match[3]);
    const avg = Math.max(60, Math.round(total / 3));
    const track = detectTrack(direction);

    let required = ["math", "informatics", "russian"];
    if (track === "economics") required = ["math", "social", "russian"];
    if (track === "engineering") required = ["math", "physics", "russian"];

    if (direction.length < 3) continue;
    out.push({
      direction,
      university: "МАИ",
      city: "Москва",
      region: "Москва",
      required,
      thresholdBudget: avg,
      thresholdPaid: 60,
      interests: INTERESTS_BY_TRACK[track],
      sourceId: source.id,
      note: "Ориентир бюджета оценен из опубликованных проходных за 2025 (средний по 3 предметам)."
    });
  }

  return uniquePrograms(out).slice(0, 30);
}

async function parseItmo(source) {
  const text = await fetchText(source.url);
  const out = [];

  const minBySubject = {};
  for (const [name, code] of Object.entries(SUBJECT_MAP)) {
    const re = new RegExp(`${name}[^\\n]{0,80}?([4-9][0-9]|100)`, "i");
    const mm = text.match(re);
    if (mm) minBySubject[code] = Number(mm[1]);
  }

  const commonMin = Math.max(60, Math.round(Object.values(minBySubject).reduce((a, b) => a + b, 0) / Math.max(1, Object.values(minBySubject).length)));

  out.push({
    direction: "Компьютерные технологии (ПМИ)",
    university: "Университет ИТМО",
    city: "Санкт-Петербург",
    region: "Санкт-Петербург",
    required: ["math", "informatics", "russian"],
    thresholdBudget: minBySubject.math && minBySubject.informatics ? Math.round((minBySubject.math + minBySubject.informatics + (minBySubject.russian || 60)) / 3) : 75,
    thresholdPaid: 60,
    interests: INTERESTS_BY_TRACK.tech,
    sourceId: source.id
  });

  out.push({
    direction: "Инженерные и цифровые технологии",
    university: "Университет ИТМО",
    city: "Санкт-Петербург",
    region: "Санкт-Петербург",
    required: ["math", "physics", "russian"],
    thresholdBudget: commonMin,
    thresholdPaid: 60,
    interests: INTERESTS_BY_TRACK.engineering,
    sourceId: source.id
  });

  return out;
}

async function parseRanepaSpb(source) {
  const text = await fetchText(source.url);
  const compact = text.replace(/\s+/g, " ").toLowerCase();

  const seedDirections = [
    "Психология",
    "Экономика",
    "Менеджмент",
    "Государственное и муниципальное управление",
    "Бизнес-информатика"
  ];

  const out = [];

  for (const direction of seedDirections) {
    const idx = compact.indexOf(direction.toLowerCase());
    if (idx === -1) continue;
    const fragment = compact.slice(Math.max(0, idx - 120), idx + 800);

    const required = pickRequiredFromText(fragment);
    const track = detectTrack(direction);
    const thresholdBudget = estimateThresholdByText(fragment, 70);

    out.push({
      direction,
      university: "РАНХиГС Санкт-Петербург",
      city: "Санкт-Петербург",
      region: "Санкт-Петербург",
      required,
      thresholdBudget,
      thresholdPaid: 60,
      interests: INTERESTS_BY_TRACK[track],
      sourceId: source.id,
      note: "Ориентир рассчитан по данным страницы вступительных испытаний и минимальных баллов."
    });
  }

  return uniquePrograms(out);
}

function uniquePrograms(programs) {
  const seen = new Set();
  const result = [];
  for (const p of programs) {
    const key = `${p.university}::${p.direction}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result;
}

async function buildPrograms(db) {
  const parsers = {
    hse_spb_2026: parseHseSpb,
    itmo_2026: parseItmo,
    mai_2026_2025: parseMai,
    ranepa_spb_2026: parseRanepaSpb
  };

  const checks = [];
  const allPrograms = [];
  const previousBySource = new Map();
  for (const item of db.programs || []) {
    const list = previousBySource.get(item.sourceId) || [];
    list.push(item);
    previousBySource.set(item.sourceId, list);
  }

  for (const source of db.sources) {
    const parser = parsers[source.id];
    if (!parser) {
      checks.push({ source: source.id, status: "skipped", count: 0, reason: "no_parser" });
      continue;
    }

    try {
      const parsed = await parser(source);
      if (parsed.length > 0) {
        allPrograms.push(...parsed);
        checks.push({ source: source.id, status: "ok", count: parsed.length });
      } else {
        const fallback = previousBySource.get(source.id) || SOURCE_SEEDS[source.id] || [];
        allPrograms.push(...fallback);
        checks.push({ source: source.id, status: "fallback", count: fallback.length, reason: "empty_parse_keep_previous" });
      }
    } catch (error) {
      const fallback = previousBySource.get(source.id) || SOURCE_SEEDS[source.id] || [];
      allPrograms.push(...fallback);
      checks.push({ source: source.id, status: "error_fallback", count: fallback.length, reason: String(error) });
    }
  }

  return { programs: uniquePrograms(allPrograms), checks };
}

async function main() {
  const raw = await fs.readFile(dbPath, "utf8");
  const db = fromJsFile(raw);

  const { programs, checks } = await buildPrograms(db);

  if (programs.length > 0) {
    db.programs = programs;
  }

  const today = new Date().toISOString().slice(0, 10);
  db.updatedAt = today;
  db.version = today;
  db.coverageNote = `Автообновление источников. Всего направлений: ${db.programs.length}.`;

  await fs.writeFile(dbPath, toJsFile(db), "utf8");

  console.log(`DB updated: version=${db.version}, programs=${db.programs.length}`);
  console.table(checks);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
