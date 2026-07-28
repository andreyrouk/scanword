// Exports data/dictionary.js to a spreadsheet-friendly CSV.
//
//   node tools/export-dictionary.mjs
//
// Output: data/dictionary.csv  (GitHub renders it as a sortable table,
// and it opens directly in Excel / Google Sheets / Numbers.)
//
// Round-trips with import-words.mjs: edit the CSV, add rows, feed it back.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DICTIONARY = require("../data/dictionary.js");
const OUT = "data/dictionary.csv";

const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;

const rows = [["word", "clue", "length"].join(",")];
DICTIONARY.slice()
  .sort((a, b) => a.word.length - b.word.length || a.word.localeCompare(b.word, "uk"))
  .forEach((e) => rows.push([esc(e.word), esc(e.clue), e.word.length].join(",")));

writeFileSync(OUT, rows.join("\n") + "\n");
console.log(`${DICTIONARY.length} entries -> ${OUT}`);
