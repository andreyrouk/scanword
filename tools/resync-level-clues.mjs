// Re-syncs clue text in already-generated level files against the current
// dictionary, so clue fixes don't require regenerating (and reshuffling)
// the whole level pool.
//
//   node tools/resync-level-clues.mjs           # report drift, change nothing
//   node tools/resync-level-clues.mjs --fix     # rewrite levels in place
//
// Why this is needed: generate-levels.mjs bakes the clue *text* into each
// level's JSON rather than referencing the dictionary at runtime. That's
// the right call for the app (a level file is self-contained, loads with
// no lookup, and can't be broken by a later dictionary edit) - but it does
// mean a clue fixed in data/dictionary.js is invisible to the 53 levels
// already sitting on disk. This closes that gap, so "fix the clues later"
// stays a real option instead of a promise the file format can't keep.
//
// Matching is by answer word: if a level's stored clue is no longer any of
// the clues the dictionary lists for that word, it's treated as drift and
// replaced with a current one. Words carrying multiple clues are common
// here (10k entries over ~7.3k unique words), so a level keeping any still
// valid clue for its word is left alone rather than churned.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DICTIONARY = require("../data/dictionary.js");
const MANIFEST = "data/levels/manifest.json";

const fix = process.argv.includes("--fix");

const cluesByWord = new Map();
for (const e of DICTIONARY) {
  if (!cluesByWord.has(e.word)) cluesByWord.set(e.word, []);
  cluesByWord.get(e.word).push(e.clue);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
let scanned = 0;
let drifted = 0;
let orphaned = 0;
const orphanExamples = [];

for (const [difficulty, files] of Object.entries(manifest)) {
  for (const file of files) {
    const path = `data/levels/${difficulty}/${file}`;
    const level = JSON.parse(readFileSync(path, "utf8"));
    let changed = false;

    for (const w of level.words) {
      scanned++;
      const valid = cluesByWord.get(w.answer);
      if (!valid || valid.length === 0) {
        // The word itself is gone from the dictionary. Can't repair this
        // by swapping clue text - the level would need regenerating - so
        // report it rather than silently inventing something.
        orphaned++;
        if (orphanExamples.length < 10) orphanExamples.push(`${path}: ${w.answer}`);
        continue;
      }
      if (!valid.includes(w.clue)) {
        drifted++;
        if (fix) {
          w.clue = valid[0];
          changed = true;
        }
      }
    }

    if (fix && changed) writeFileSync(path, JSON.stringify(level));
  }
}

console.log(`Scanned ${scanned} clues across ${Object.values(manifest).flat().length} levels.`);
console.log(`  drift (clue no longer in dictionary): ${drifted}`);
console.log(`  orphaned (answer word removed entirely): ${orphaned}`);
orphanExamples.forEach((o) => console.log(`      ${o}`));
if (orphaned > 0) {
  console.log("  -> orphaned words need the level regenerated, not just re-clued.");
}
if (drifted > 0 && !fix) {
  console.log("\nRe-run with --fix to rewrite these in place.");
} else if (fix) {
  console.log("\nLevels rewritten.");
}
