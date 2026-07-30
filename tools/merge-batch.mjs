// Appends a validated word,clue,length batch CSV into data/dictionary.js.
//
//   node tools/merge-batch.mjs tools/batches/some-batch.csv
//
// Unlike import-words.mjs, this does NOT reject words that already exist
// elsewhere in the dictionary -- a word can legitimately recur with a
// different clue (homonyms/double meanings), and the puzzle generator
// already avoids reusing a word within a single generated puzzle. Run
// tools/validate_wordlist.py against the batch first; this script assumes
// that gate has already passed (it still skips in-batch duplicates and
// bad rows defensively, but won't fix them for you).

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DICT_PATH = "data/dictionary.js";
const UKR_LETTERS = /^[А-ЩЬЮЯЇІЄҐ]+$/;
const MIN_LEN = 3;
const MAX_LEN = 12;
const MAX_CLUE = 70;

function parseCsvLine(line) {
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
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!file) {
    console.error("Usage: node tools/merge-batch.mjs <batch.csv> [--dry-run]");
    process.exit(1);
  }

  const existing = require(`../${DICT_PATH}`);

  let text = readFileSync(file, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const lines = text.split(/\r?\n/);
  const added = [];
  const rejects = [];
  const seenInBatch = new Set();

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    if (idx === 0 && /^word,clue,length$/i.test(line)) return;

    const [wRaw, clRaw] = parseCsvLine(line);
    const word = (wRaw || "").trim().toUpperCase();
    const clue = (clRaw || "").trim();

    const reject = (why) => rejects.push({ line: idx + 1, word: word || raw.slice(0, 24), why });

    if (!clue) return reject("no clue");
    if (!UKR_LETTERS.test(word)) return reject("word must be Ukrainian letters only");
    if (word.length < MIN_LEN || word.length > MAX_LEN) return reject(`bad length (${word.length})`);
    if (clue.length > MAX_CLUE) return reject(`clue over ${MAX_CLUE} chars`);
    if (seenInBatch.has(word)) return reject("duplicate within this batch");

    seenInBatch.add(word);
    added.push({ word, clue });
  });

  console.log(`read ${file}: ${added.length} to add, ${rejects.length} rejected`);
  if (rejects.length) {
    rejects.forEach((r) => console.log(`  line ${r.line}  ${r.word}  - ${r.why}`));
  }
  if (!added.length) { console.log("nothing to add."); return; }

  if (dryRun) { console.log("--dry-run: dictionary not modified."); return; }

  const merged = existing.concat(added);
  const body = merged
    .map((e) => `  { word: ${JSON.stringify(e.word)}, clue: ${JSON.stringify(e.clue)} },`)
    .join("\n");
  writeFileSync(
    DICT_PATH,
    `// Ukrainian word + clue dictionary for the scanword generator.\n` +
      `// Format: { word, clue }. word: uppercase Cyrillic only, 3+ letters,\n` +
      `// no apostrophes/hyphens (each grid cell holds exactly one letter).\n` +
      `// Duplicate words across the list are fine (homonyms/double meanings);\n` +
      `// the generator never reuses a word within a single puzzle.\n` +
      `// Edit via tools/import-words.mjs (new words) or tools/merge-batch.mjs (validated batches).\n` +
      `const DICTIONARY = [\n${body}\n];\n\n` +
      `if (typeof module !== "undefined" && module.exports) {\n  module.exports = DICTIONARY;\n}\n`
  );
  console.log(`${DICT_PATH}: ${existing.length} -> ${merged.length} entries`);
}

main();
