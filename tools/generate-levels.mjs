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

// Each tier is a *range* of shapes, not one fixed size. Measured directly
// (see rect-test in the session that added this): exact-shape difficulty
// isn't a clean function of area - 7x13 (91 cells) failed in 30s while
// 9x12 (108 cells, more cells) succeeded. Committing to one exact
// rows x cols before knowing whether the dictionary actually tiles it
// that way is gambling; instead, generateOne below tries a shuffled batch
// of candidate shapes within the tier's range and keeps whichever one the
// words cooperate with. That also happens to be the whole point of the
// exercise: variety across 6x6 up through wide/tall rectangles like 7x13
// or 10x18, not a fixed size, since a scanword doesn't need to be square.
const TIERS = {
  easy: { minDim: 6, maxDim: 8, maxArea: 56, budgetMs: 25000, maxWordLenOptions: [6] },
  medium: { minDim: 7, maxDim: 12, maxArea: 110, budgetMs: 60000, maxWordLenOptions: [6, 7] },
  hard: { minDim: 8, maxDim: 18, maxArea: 170, budgetMs: 120000, maxWordLenOptions: [6, 7] },
};

// Every distinct (rows, cols) pair (both orientations - 7x13 and 13x7 are
// different shapes on screen even though the search doesn't care) that
// fits within the tier's dimension and area bounds, shuffled so repeated
// runs don't all reach for the same handful of shapes first.
function candidateShapes(tier) {
  const shapes = [];
  for (let r = tier.minDim; r <= tier.maxDim; r++) {
    for (let c = tier.minDim; c <= tier.maxDim; c++) {
      if (r * c <= tier.maxArea) shapes.push([r, c]);
    }
  }
  return shuffle(shapes);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildVmContext() {
  const ctx = { DICTIONARY, console, Date, Math, setTimeout, Promise };
  vm.createContext(ctx);
  for (const f of ["js/grid-skeleton.js", "js/word-filler.js", "js/generator.js"]) {
    vm.runInContext(readFileSync(f, "utf8"), ctx, { filename: f });
  }
  return ctx;
}

// Caps how many distinct shapes get a real try per puzzle - trying all of
// them would slice the budget so thin that none gets a fair shot, and a
// handful of fresh random shapes is already very different from
// stubbornly retrying one fixed size.
const SHAPES_PER_ATTEMPT = 8;

async function generateOne(tier, budgetMs) {
  const shapes = candidateShapes(tier).slice(0, SHAPES_PER_ATTEMPT);
  const perShape = Math.floor(budgetMs / shapes.length);
  for (const [rows, cols] of shapes) {
    // Split each shape's slice across the maxWordLen options to try - if 6
    // is having a bad run on this shape, giving 7 a turn (or vice versa)
    // is often faster than waiting out 6 alone.
    const perOption = Math.floor(perShape / tier.maxWordLenOptions.length);
    for (const maxWordLen of tier.maxWordLenOptions) {
      const ctx = buildVmContext();
      ctx.__args = [rows, cols, DICTIONARY, { timeBudgetMs: perOption, maxWordLen }];
      const result = await vm.runInContext("generatePuzzle(...__args)", ctx);
      if (result) return result;
    }
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
    const start = Date.now();
    process.stdout.write(`[${difficulty}] ${i + 1}/${count}... `);
    const result = await generateOne(tier, budgetMs);
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
