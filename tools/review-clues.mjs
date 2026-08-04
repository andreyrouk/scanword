// Flags dictionary entries whose clues are likely weak, and writes them to
// a CSV for human review.
//
//   node tools/review-clues.mjs                 # report + write review CSV
//   node tools/review-clues.mjs --only mechanical
//   node tools/review-clues.mjs --limit 200
//
// Output: data/clue-review.csv  (word, clue, reasons, length)
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

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DICTIONARY = require("../data/dictionary.js");
const OUT = "data/clue-review.csv";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1], 10) : Infinity;

// NOTE: no \b anywhere in these patterns. JavaScript's \b is defined over
// [A-Za-z0-9_], so against Cyrillic it matches in the wrong places and
// silently returns nothing - a "0 results, all clean!" that is simply a
// broken regex. (That exact bug hid the mechanical number clues on the
// first pass at this analysis.)
const CHECKS = [
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
for (const entry of DICTIONARY) {
  const reasons = reasonsFor(entry);
  if (reasons.length) flagged.push({ ...entry, reasons });
}

const dupes = duplicateClueGroups(DICTIONARY);

console.log(`Dictionary: ${DICTIONARY.length} entries\n`);
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
