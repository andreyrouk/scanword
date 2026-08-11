// Flags dictionary entries whose clues are likely weak, and writes them to
// a CSV for human review.
//
//   node tools/review-clues.mjs                 # report + write review CSV
//   node tools/review-clues.mjs --only mechanical
//   node tools/review-clues.mjs --limit 200
//
// Output: data/clue-review.csv  (word, clue, reasons, length)
//
//   --shipped   review only the clues baked into data/levels/, i.e. the ones
//               players actually meet (~1k, versus ~10k in the dictionary)
//
// Round-trips with the existing pipeline: edit the clue column in that
// CSV, then feed it back through tools/import-words.mjs. Deleting a row
// means "leave this entry alone", so a reviewer only keeps the rows they
// actually changed.
//
// This deliberately only *surfaces candidates* - it never edits the
// dictionary itself. Clue quality is a judgment call a native speaker
// makes instantly and a regex cannot: measured on this dictionary, a
// broad "sequence words" pattern flagged 164 entries of which most were
// good clues ("Слово після всіх слів" for ЕПІЛОГ is a fine clue, not a
// mechanical one). So the heuristics are tuned to be *narrow and
// specific* rather than catch-all, and everything still gets a human
// pass. Precision over recall: a noisy report is a report nobody reads.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DICTIONARY = require("../data/dictionary.js");
const OUT = "data/clue-review.csv";
const LEVELS_DIR = "data/levels";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1], 10) : Infinity;
const shippedOnly = args.includes("--shipped");

// The clues worth arguing about are the ones players actually meet. The
// dictionary is ~10k entries; the 100 levels use about a tenth of that, so
// --shipped turns "review the dictionary" into a job that finishes.
function shippedPairs() {
  const pairs = new Map();
  for (const tier of ["easy", "medium", "hard"]) {
    let files;
    try {
      files = readdirSync(`${LEVELS_DIR}/${tier}`);
    } catch (err) {
      continue;
    }
    for (const file of files) {
      const level = JSON.parse(readFileSync(`${LEVELS_DIR}/${tier}/${file}`, "utf8"));
      for (const w of level.words) pairs.set(w.answer + "|" + w.clue, { word: w.answer, clue: w.clue });
    }
  }
  return [...pairs.values()];
}

const ENTRIES = shippedOnly ? shippedPairs() : DICTIONARY;

// NOTE: no \b anywhere in these patterns. JavaScript's \b is defined over
// [A-Za-z0-9_], so against Cyrillic it matches in the wrong places and
// silently returns nothing - a "0 results, all clean!" that is simply a
// broken regex. (That exact bug hid the mechanical number clues on the
// first pass at this analysis.)
const CHECKS = [
  {
    id: "self-spoiling",
    label: "clue contains its own answer - gives the game away outright",
    // Found five of these in the 10k: "Те, що суворе, але воно закон" for
    // ЗАКОН, and subtler ones where the answer hides inside a longer word
    // ("Подарунок" for ДАР, "Буковині" for БУК). Apostrophes are stripped
    // because answers carry none, so ДЕВЯТЬ has to match "дев'ять".
    test: (e) => e.clue.toUpperCase().replace(/['\u2019\u02bc]/g, "").includes(e.word),
  },
  {
    id: "mechanical",
    label: "mechanically derivable (no knowledge or wit required)",
    // "Число після трьох" -> ЧОТИРИ. The answer is deducible from the
    // clue alone by counting, so it tests nothing.
    test: (e) => /^Число (після|перед)/i.test(e.clue),
  },
  {
    id: "too-generic",
    label: "clue is a bare category, could fit many answers",
    test: (e) => /^(Тварина|Рослина|Птах|Риба|Комаха|Місто|Країна|Колір|Число|Предмет|Людина)\.?$/i.test(e.clue.trim()),
  },
  {
    id: "very-short",
    label: "very short clue - often too vague to be solvable",
    test: (e) => e.clue.trim().length < 12,
  },
  {
    id: "near-max-length",
    label: "at the length cap - renders as tiny text in a small cell",
    test: (e) => e.clue.length >= 66,
  },
  // --- gloss shapes: a clue that names the answer's class and then narrows
  // it is a dictionary definition, not a puzzle clue. "Комаха з жовто-чорним
  // черевцем і жалом" for ОСА asks for no thought; "Танк савани" for
  // НОСОРІГ asks for one. This is a candidate list, not a verdict - a gloss
  // over a word most people don't know ("Велика притока Міссісіпі" for
  // ОГАЙО) is a legitimate knowledge clue. Judgement still needed per row.
  //
  // NOTE the boundary: (?![а-яіїєґ]) and NOT \b. See the warning above -
  // \b never matches after a Cyrillic letter, and using it here made this
  // whole family of checks silently find nothing on the first attempt.
  {
    id: "gloss-periphrasis",
    label: "\"the one who/that ...\" - a definition wearing a disguise",
    test: (e) => /^(Той|Та|Те|Ті),?\s+(хто|що|чим|яка|який)/i.test(e.clue),
  },
  {
    id: "gloss-class",
    label: "opens by naming the answer's category, then narrows it",
    test: (e) =>
      new RegExp(
        "^(Орган|Житло|Дитина|Частина|Прилад|Пристрій|Засіб|Місце|Речовина|Процес|Наука|Особа|Людина|Стан|Здатність|" +
          "Сукупність|Одиниця|Явище|Різновид|Вид|Група|Набір|Знак|Символ|Період|Проміжок|Відрізок|Комаха|Дерево|" +
          "Рослина|Тварина|Птах|Риба|Квітка|Метал|Газ|Кислота|Мінерал|Ємність|Місткість|Установа|Футляр|Годівниця)(?![а-яіїєґ])",
        "i"
      ).test(e.clue),
  },
  {
    id: "gloss-instrument",
    label: "\"X для Y\" - names the tool and its purpose, which is the definition",
    test: (e) => /^\S+\s+для\s+/i.test(e.clue),
  },
  {
    id: "encyclopedic",
    label: "reads like a dictionary definition rather than a puzzle clue",
    test: (e) => /^(Той, що|Та, що|Те, що|Той, хто|Та, хто)/i.test(e.clue) && e.clue.length > 45,
  },
];

function reasonsFor(entry) {
  return CHECKS.filter((c) => (!only || c.id === only) && c.test(entry)).map((c) => c.id);
}

// Clue text reused for two *different* answers. Often legitimate (real
// synonyms like ПІЛОТ/ЛЬОТЧИК), but it's also how genuine errors surface:
// this check is what exposed ХОЛСТ (Russian for полотно), ПИТОН (Russian
// spelling of пітон) and ВОДЕРПОЛО (typo for ватерполо) - none of which a
// Cyrillic-alphabet-only validator can catch, since they're all spelled
// with perfectly valid Ukrainian letters.
function duplicateClueGroups(dict) {
  const byClue = new Map();
  dict.forEach((e) => {
    const k = e.clue.toLowerCase().trim();
    if (!byClue.has(k)) byClue.set(k, new Set());
    byClue.get(k).add(e.word);
  });
  return [...byClue.entries()].filter(([, words]) => words.size > 1);
}

const flagged = [];
for (const entry of ENTRIES) {
  const reasons = reasonsFor(entry);
  if (reasons.length) flagged.push({ ...entry, reasons });
}

const dupes = duplicateClueGroups(ENTRIES);

console.log(shippedOnly ? `Shipped in levels: ${ENTRIES.length} clue/answer pairs\n` : `Dictionary: ${ENTRIES.length} entries\n`);
console.log("Flagged by check:");
for (const c of CHECKS) {
  if (only && c.id !== only) continue;
  const n = flagged.filter((f) => f.reasons.includes(c.id)).length;
  console.log(`  ${String(n).padStart(5)}  ${c.id.padEnd(16)} ${c.label}`);
}
console.log(`\n  ${String(dupes.length).padStart(5)}  duplicate-clue    same clue text used for different answers`);
if (dupes.length) {
  console.log("         (check these for typos / russisms, not just synonyms)");
  dupes.slice(0, 8).forEach(([clue, words]) => console.log(`         "${clue}" -> ${[...words].join(", ")}`));
  if (dupes.length > 8) console.log(`         ...and ${dupes.length - 8} more`);
}

const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const rows = [["word", "clue", "reasons", "length"].join(",")];
flagged.slice(0, limit).forEach((f) => {
  rows.push([esc(f.word), esc(f.clue), esc(f.reasons.join(" ")), f.clue.length].join(","));
});
writeFileSync(OUT, rows.join("\n") + "\n");

console.log(`\nTotal flagged: ${flagged.length}`);
console.log(`Wrote ${Math.min(flagged.length, limit)} rows -> ${OUT}`);
console.log("Edit the clue column there, then: node tools/import-words.mjs " + OUT);
