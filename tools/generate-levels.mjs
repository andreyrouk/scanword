// Batch-generates puzzles offline and saves them as static JSON "levels",
// bucketed by difficulty, for the app to load instantly instead of
// generating live in the browser.
//
//   node tools/generate-levels.mjs <difficulty> <count> [budgetMs]
//   node tools/generate-levels.mjs easy 10
//   node tools/generate-levels.mjs hard 5 90000
//
// Why this exists instead of just raising the live time budget further:
// the live UI has to finish within a user's patience (seconds), which
// forced maxWordLen down to 6 and rows/cols up to 10 - both are tuned for
// "must succeed in a browser tab right now." Offline, none of that
// pressure exists: this script can spend minutes per puzzle, retry with
// different maxWordLen values, and only the survivors ever get shipped.
// That turns "will this generate in time" into a one-time batch-job
// question instead of a per-request one.
//
// Reuses the real browser files unmodified (grid-skeleton.js,
// word-filler.js, generator.js all stay plain global-scope scripts loaded
// via <script> tags in index.html) by evaluating them into a shared vm
// context here, the same way they share `window` in a browser tab.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const DICTIONARY = require("../data/dictionary.js");

// Each tier is a list of candidate sizes (one is picked per puzzle) and a
// per-puzzle time budget generous enough for that size's real difficulty
// - not the live UI's 15s-plus-4s-per-unit formula, which is deliberately
// stingy to keep a browser tab responsive. maxWordLenOptions are tried in
// order across retries within the budget: capping at 6 is what makes
// filling reliable, but letting a fraction of attempts try 7 costs
// nothing here and occasionally lands a puzzle with a bit more variety.
const TIERS = {
  easy: { sizes: [6, 7], budgetMs: 20000, maxWordLenOptions: [6] },
  medium: { sizes: [8, 9], budgetMs: 45000, maxWordLenOptions: [6, 7] },
  hard: { sizes: [10, 11], budgetMs: 90000, maxWordLenOptions: [6, 7] },
};

function buildVmContext() {
  const ctx = { DICTIONARY, console, Date, Math, setTimeout, Promise };
  vm.createContext(ctx);
  for (const f of ["js/grid-skeleton.js", "js/word-filler.js", "js/generator.js"]) {
    vm.runInContext(readFileSync(f, "utf8"), ctx, { filename: f });
  }
  return ctx;
}

async function generateOne(size, budgetMs, maxWordLenOptions) {
  // Split the budget across the maxWordLen options to try instead of
  // spending it all on the first one - if 6 is having a bad run, giving
  // 7 a turn (or vice versa) is often faster than waiting out 6 alone.
  const perOption = Math.floor(budgetMs / maxWordLenOptions.length);
  for (const maxWordLen of maxWordLenOptions) {
    const ctx = buildVmContext();
    ctx.__args = [size, size, DICTIONARY, { timeBudgetMs: perOption, maxWordLen }];
    const result = await vm.runInContext("generatePuzzle(...__args)", ctx);
    if (result) return result;
  }
  return null;
}

function slugify(rows, cols, index) {
  return `${rows}x${cols}-${String(index).padStart(3, "0")}`;
}

async function main() {
  const [difficulty, countArg, budgetArg] = process.argv.slice(2);
  const tier = TIERS[difficulty];
  if (!tier) {
    console.error(`Usage: node tools/generate-levels.mjs <${Object.keys(TIERS).join("|")}> <count> [budgetMs]`);
    process.exit(1);
  }
  const count = parseInt(countArg, 10) || 1;
  const budgetMs = budgetArg ? parseInt(budgetArg, 10) : tier.budgetMs;

  const outDir = `data/levels/${difficulty}`;
  mkdirSync(outDir, { recursive: true });

  const manifestPath = "data/levels/manifest.json";
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  for (const d of Object.keys(TIERS)) if (!manifest[d]) manifest[d] = [];
  const nextIndex = manifest[difficulty].length;

  let ok = 0;
  for (let i = 0; i < count; i++) {
    const size = tier.sizes[Math.floor(Math.random() * tier.sizes.length)];
    const start = Date.now();
    process.stdout.write(`[${difficulty}] ${i + 1}/${count} (${size}x${size})... `);
    const result = await generateOne(size, budgetMs, tier.maxWordLenOptions);
    if (!result) {
      console.log(`FAILED after ${Date.now() - start}ms`);
      continue;
    }
    const name = slugify(result.rows, result.cols, nextIndex + ok);
    const file = `${name}.json`;
    // clueCells is dropped: it's fully derived from `words` by
    // buildClueCells() in generator.js, so storing it would just be
    // redundant bytes the loader has to trust match `words` anyway.
    writeFileSync(`${outDir}/${file}`, JSON.stringify({ rows: result.rows, cols: result.cols, isClue: result.isClue, words: result.words }));
    manifest[difficulty].push(file);
    ok++;
    console.log(`OK in ${Date.now() - start}ms -> ${outDir}/${file}`);
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\n${ok}/${count} succeeded. Manifest updated: ${manifestPath}`);
}

main();
