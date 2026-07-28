// Merges a word+clue file into data/dictionary.js, validating every row.
//
//   node tools/import-words.mjs my-words.csv
//   node tools/import-words.mjs my-words.csv --dry-run
//
// Accepts one entry per line as "word<SEP>clue", where <SEP> is a tab,
// semicolon, pipe, em-dash, or comma. Quoted CSV ("word","clue with,
// commas") is handled properly, so a file exported by
// export-dictionary.mjs can be edited and fed straight back.
//
// Every rule enforced here exists because breaking it breaks the puzzle:
// a grid cell holds exactly one letter, a clue that contains its own
// answer gives the game away, and an over-long clue shrinks to unreadable
// type in a small cell. Rejected rows are reported with a reason rather
// than dropped silently, so nothing disappears without you knowing.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DICT_PATH = "data/dictionary.js";
const UKR_LETTERS = /^[А-ЩЬЮЯЇІЄҐ]+$/; // uppercase Ukrainian only
const MIN_LEN = 3;
const MAX_LEN = 12;
const MAX_CLUE = 70; // longer clues shrink to unreadable type in a cell

function splitRow(line) {
  // Proper CSV first: "a","b"  or  "a",b
  if (line.startsWith('"')) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === "," || ch === "\t" || ch === ";") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  // Otherwise split on the first separator we find.
  for (const sep of ["\t", ";", "|", " — ", " - ", ","]) {
    const i = line.indexOf(sep);
    if (i > 0) return [line.slice(0, i), line.slice(i + sep.length)];
  }
  return [line];
}

function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!file) {
    console.error("Usage: node tools/import-words.mjs <file.csv> [--dry-run]");
    process.exit(1);
  }

  const existing = require(`../${DICT_PATH}`);
  const have = new Map(existing.map((e) => [e.word, e.clue]));

  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const added = [];
  const rejects = [];
  const seenInFile = new Set();

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;

    const parts = splitRow(line);
    let [w, ...rest] = parts;
    let word = (w || "").trim().toUpperCase();
    let clue = rest.join(",").trim();

    // Skip a header row from an exported CSV.
    if (idx === 0 && /^word$/i.test(word)) return;
    // Drop a trailing numeric "length" column if present.
    clue = clue.replace(/[,;\t]\s*\d+\s*$/, "").trim();

    const reject = (why) => rejects.push({ line: idx + 1, word: word || raw.slice(0, 24), why });

    if (!clue) return reject("no clue");
    if (!UKR_LETTERS.test(word)) return reject("word must be Ukrainian letters only (no spaces, apostrophes or hyphens)");
    if (word.length < MIN_LEN) return reject(`shorter than ${MIN_LEN} letters`);
    if (word.length > MAX_LEN) return reject(`longer than ${MAX_LEN} letters`);
    if (clue.length > MAX_CLUE) return reject(`clue over ${MAX_CLUE} chars (would render too small)`);
    if (seenInFile.has(word)) return reject("duplicate within this file");
    if (have.has(word)) return reject("already in dictionary");

    // A clue must not contain its own answer, nor an obvious stem of it.
    const stem = word.slice(0, Math.max(4, word.length - 2));
    if (clue.toUpperCase().includes(stem)) return reject("clue contains the answer");

    seenInFile.add(word);
    added.push({ word, clue });
  });

  console.log(`read ${file}: ${added.length} to add, ${rejects.length} rejected`);
  if (rejects.length) {
    console.log("\nrejected:");
    rejects.slice(0, 40).forEach((r) => console.log(`  line ${r.line}  ${r.word}  - ${r.why}`));
    if (rejects.length > 40) console.log(`  ... and ${rejects.length - 40} more`);
  }
  if (!added.length) { console.log("\nnothing to add."); return; }

  const byLen = {};
  added.forEach((e) => (byLen[e.word.length] = (byLen[e.word.length] || 0) + 1));
  console.log("\nadded by length:", JSON.stringify(byLen));

  if (dryRun) { console.log("\n--dry-run: dictionary not modified."); return; }

  const merged = existing.concat(added);
  const body = merged
    .map((e) => `  { word: ${JSON.stringify(e.word)}, clue: ${JSON.stringify(e.clue)} },`)
    .join("\n");
  writeFileSync(
    DICT_PATH,
    `// Ukrainian word + clue dictionary for the scanword generator.\n` +
      `// Format: { word, clue }. word: uppercase Cyrillic only, 3+ letters,\n` +
      `// no apostrophes/hyphens (each grid cell holds exactly one letter).\n` +
      `// Keep entries unique by word. Edit via tools/import-words.mjs.\n` +
      `const DICTIONARY = [\n${body}\n];\n\n` +
      `if (typeof module !== "undefined" && module.exports) {\n  module.exports = DICTIONARY;\n}\n`
  );
  console.log(`\n${DICT_PATH}: ${existing.length} -> ${merged.length} entries`);
}

main();
