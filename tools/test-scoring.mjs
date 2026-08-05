// Tests for js/scoring.js. No framework - plain asserts, run directly:
//
//   node tools/test-scoring.mjs
//
// Worth having despite the repo's no-build philosophy: the scoring formula
// has a lot of interacting knobs (par pace, hint cost, star gates, speed
// cap) that will get retuned as real play data arrives, and the properties
// asserted below are the ones that must survive any retuning - especially
// "hints can never buy a top score", which is what keeps a future paid-hint
// feature from becoming pay-to-win on the leaderboard.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { scoreSolve, parTimeSeconds, speedFactor, streakMultiplier, SCORING } = require("../js/scoring.js");

let passed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
  } else {
    failures.push(`${name}${detail ? " - " + detail : ""}`);
  }
}

const W = 20;
const par = parTimeSeconds(W); // 300s
const solve = (a) => scoreSolve({ wordCount: W, difficulty: "medium", ...a });

// --- par time ---------------------------------------------------------
check("par scales with word count", parTimeSeconds(10) === 10 * SCORING.SECONDS_PER_WORD);
check("par of empty puzzle is not zero", parTimeSeconds(0) > 0, "guards divide-by-zero downstream");

// --- speed factor -----------------------------------------------------
check("at par -> factor 1", speedFactor(par, par) === 1);
check("at 2x par -> factor 0", speedFactor(par * 2, par) === 0);
check("beyond 2x par never negative", speedFactor(par * 10, par) === 0, "slow play must not subtract points");
check("blazing fast is capped", speedFactor(1, par) === SCORING.SPEED_FACTOR_MAX);
check("zero elapsed does not blow up", Number.isFinite(speedFactor(0, par)));

// --- stars ------------------------------------------------------------
check("3 stars: clean and within gate", solve({ solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par }).stars === 3);
check(
  "3 stars survives deliberate play",
  solve({ solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par * 1.4 }).stars === 3,
  "a thoughtful solver must not be demoted for taking their time"
);
check(
  "loses 3rd star past the gate",
  solve({ solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par * 2.5 }).stars === 2
);
check(
  "2 stars with a few hints",
  solve({ solvedUnaided: W - 2, hintsUsed: 2, elapsedSeconds: par, completed: true }).stars === 2
);
check(
  "1 star when heavily hinted",
  solve({ solvedUnaided: 0, hintsUsed: W, elapsedSeconds: par, completed: true }).stars === 1
);
check("0 stars when unfinished", solve({ solvedUnaided: 14, hintsUsed: 0, elapsedSeconds: par, completed: false }).stars === 0);

// --- perfect flag -----------------------------------------------------
check("perfect requires clean AND under par", solve({ solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par }).perfect === true);
check(
  "perfect is stricter than 3 stars",
  (() => {
    const r = solve({ solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par * 1.4 });
    return r.stars === 3 && r.perfect === false;
  })(),
  "the speed flex must not be the same thing as full stars"
);

// --- points: ordering properties that must always hold ----------------
const clean = solve({ solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par });
const hinted = solve({ solvedUnaided: W - 5, hintsUsed: 5, elapsedSeconds: par, completed: true });
const spam = solve({ solvedUnaided: 0, hintsUsed: W, elapsedSeconds: par / 2, completed: true });
const partial = solve({ solvedUnaided: 14, hintsUsed: 0, elapsedSeconds: par, completed: false });

check("clean beats hinted at equal time", clean.points > hinted.points);
check(
  "hint-spam cannot buy a top score",
  spam.points < clean.points * 0.25,
  "keeps a future paid-hint feature from being pay-to-win"
);
check("solving most of it unaided beats revealing all of it", partial.points > spam.points);
check("finishing beats not finishing, all else equal", clean.points > partial.points);
check("faster is worth more", solve({ solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par / 2 }).points > clean.points);
check("harder difficulty pays more",
  scoreSolve({ wordCount: W, difficulty: "hard", solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par }).points >
  scoreSolve({ wordCount: W, difficulty: "easy", solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par }).points);

// --- robustness against junk input ------------------------------------
check("points never negative", solve({ solvedUnaided: 0, hintsUsed: 999, elapsedSeconds: par, completed: true }).points >= 0);
check("solvedUnaided cannot exceed wordCount", solve({ solvedUnaided: 999, hintsUsed: 0, elapsedSeconds: par }).breakdown.base === W * SCORING.POINTS_PER_WORD);
check("empty puzzle does not produce NaN", Number.isFinite(scoreSolve({ wordCount: 0, solvedUnaided: 0, elapsedSeconds: 10 }).points));
check("unknown difficulty falls back to 1x",
  scoreSolve({ wordCount: W, difficulty: "nonsense", solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par }).points ===
  scoreSolve({ wordCount: W, difficulty: "easy", solvedUnaided: W, hintsUsed: 0, elapsedSeconds: par }).points);

// --- streaks ----------------------------------------------------------
check("streak starts at 1x", streakMultiplier(1) === 1);
check("streak grows", streakMultiplier(10) > streakMultiplier(2));
check("streak is capped", streakMultiplier(10000) === 1.5, "a long streak must not make the board unwinnable for newcomers");
check("negative streak is harmless", streakMultiplier(-5) === 1);

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log("  FAIL: " + f));
  process.exit(1);
}
