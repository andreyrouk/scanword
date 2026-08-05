// Scores every generated level for difficulty and emits an ordered
// campaign ladder.
//
//   node tools/build-ladder.mjs            # all levels, ordered
//   node tools/build-ladder.mjs --limit 100
//
// Output: data/levels/ladder.json
//
// There is no ground truth for "how hard is this scanword" yet - nobody
// has played them. So this is an explicitly provisional proxy built from
// signals we can actually measure, chosen because they spread across the
// corpus rather than because they're known to be correct:
//
//   words      9..36  - how much solving the puzzle asks for. Widest
//                       spread of any signal, so it carries most weight.
//   rare       0..1   - share of answers that are uncommon or absent from
//                       the frequency list. The other genuinely wide
//                       signal, and the one closest to "do I know this
//                       word at all".
//   crossRatio .58..77 - fraction of letter cells shared by two words.
//                       More crossings = more free letters = easier, so
//                       it's inverted here. Narrow range, low weight.
//   avgLen     3.5..4.8 - longer answers are harder to guess cold. Also
//                       narrow, also low weight.
//
// The frequency list only covers ~32% of dictionary words, so `rare`
// conflates "genuinely obscure" with "absent from a noisy corpus". That's
// tolerable for ordering (both push a level later in the ladder, which is
// the right direction) but it is NOT a measure of true difficulty. Once
// real completion times exist they should replace these weights outright -
// players are the only reliable calibration.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CANDIDATES = require("../data/wordlist-candidates.json");
const MANIFEST = "data/levels/manifest.json";
const OUT = "data/levels/ladder.json";

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1], 10) : Infinity;

const RARE_FREQ_THRESHOLD = 30;
const WEIGHTS = { words: 0.4, rare: 0.3, crossings: 0.15, avgLen: 0.15 };

const freq = new Map(CANDIDATES.map((c) => [c.word, c.freq]));
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

function measure(tier, file) {
  const path = `data/levels/${tier}/${file}`;
  const level = JSON.parse(readFileSync(path, "utf8"));
  const letterCells = level.isClue.flat().filter((x) => !x).length;

  const cellUse = new Map();
  level.words.forEach((w) => w.cells.forEach(([r, c]) => cellUse.set(r + "," + c, (cellUse.get(r + "," + c) || 0) + 1)));
  const crossings = [...cellUse.values()].filter((v) => v > 1).length;

  const wordCount = level.words.length;
  const avgLen = level.words.reduce((s, w) => s + w.answer.length, 0) / wordCount;
  const rare = level.words.filter((w) => !freq.has(w.answer) || freq.get(w.answer) < RARE_FREQ_THRESHOLD).length / wordCount;

  return {
    file: `${tier}/${file}`,
    rows: level.rows,
    cols: level.cols,
    words: wordCount,
    raw: { words: wordCount, rare, crossings: crossings / letterCells, avgLen },
  };
}

const levels = [];
for (const [tier, files] of Object.entries(manifest)) {
  if (tier === "daily") continue; // reserved; not part of the campaign
  for (const file of files) levels.push(measure(tier, file));
}

// Min-max normalise each signal across the corpus so the weights mean what
// they say - raw units (a word count of 36 vs a ratio of 0.77) would
// otherwise let whichever signal happens to have the largest numbers
// dominate regardless of its weight.
function normaliser(key) {
  const vals = levels.map((l) => l.raw[key]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return (v) => (max === min ? 0 : (v - min) / (max - min));
}
const norm = {
  words: normaliser("words"),
  rare: normaliser("rare"),
  crossings: normaliser("crossings"),
  avgLen: normaliser("avgLen"),
};

levels.forEach((l) => {
  l.difficulty =
    WEIGHTS.words * norm.words(l.raw.words) +
    WEIGHTS.rare * norm.rare(l.raw.rare) +
    // Inverted: more crossings means more letters handed to the player.
    WEIGHTS.crossings * (1 - norm.crossings(l.raw.crossings)) +
    WEIGHTS.avgLen * norm.avgLen(l.raw.avgLen);
});

levels.sort((a, b) => a.difficulty - b.difficulty);
const ladder = levels.slice(0, limit);

// Tier is assigned by final ladder position rather than by which folder
// the level was generated into: an "easy"-folder puzzle can well out-rank
// a "medium" one on the composite score, and the score multiplier the
// player receives should match the difficulty they actually faced.
const tierFor = (i, total) => (i < total / 3 ? "easy" : i < (total * 2) / 3 ? "medium" : "hard");

const out = {
  generated: new Date().toISOString(),
  weights: WEIGHTS,
  count: ladder.length,
  levels: ladder.map((l, i) => ({
    n: i + 1,
    file: l.file,
    rows: l.rows,
    cols: l.cols,
    words: l.words,
    tier: tierFor(i, ladder.length),
    difficulty: Number(l.difficulty.toFixed(4)),
  })),
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log(`Ladder: ${ladder.length} levels -> ${OUT}`);
const show = [0, Math.floor(ladder.length / 4), Math.floor(ladder.length / 2), Math.floor((ladder.length * 3) / 4), ladder.length - 1];
console.log("\n  #     shape   words  rare  difficulty  tier");
show.forEach((i) => {
  const l = ladder[i];
  const o = out.levels[i];
  console.log(
    `  ${String(o.n).padStart(3)}  ${(l.rows + "x" + l.cols).padStart(6)}  ${String(l.words).padStart(5)}  ${l.raw.rare.toFixed(2)}  ${o.difficulty.toFixed(4)}      ${o.tier}`
  );
});
