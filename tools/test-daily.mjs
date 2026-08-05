// Tests for js/daily.js.  node tools/test-daily.mjs
//
// The properties here are the ones a leaderboard will later depend on:
// everyone must get the same puzzle for a given date, the pool must cycle
// without early repeats, and a streak must not be inflatable by replaying
// the same day.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// daily.js touches localStorage at call time, not import time; give it a
// working stub so storage paths are exercised rather than the fallback.
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const d = require("../js/daily.js");

let passed = 0;
const failures = [];
const check = (name, cond, detail = "") => {
  if (cond) passed++;
  else failures.push(`${name}${detail ? " - " + detail : ""}`);
};

// A stand-in ladder: 40 levels, 12 of them hard. Two of the hard ones are
// deliberately tiny, mirroring the real ladder where a 9-word 6x6 of very
// rare answers scores into the hard third - the daily must not pick those.
const levels = Array.from({ length: 40 }, (_, i) => ({
  n: i + 1,
  file: `f${i + 1}.json`,
  tier: i >= 28 ? "hard" : i >= 14 ? "medium" : "easy",
  words: i === 30 || i === 31 ? 9 : 22,
}));

// --- date keys --------------------------------------------------------
check("date key is UTC YYYY-MM-DD", d.dailyDateKey(new Date("2026-08-05T23:30:00Z")) === "2026-08-05");
check(
  "late-evening UTC does not roll over early",
  d.dailyDateKey(new Date("2026-08-05T23:59:59Z")) === "2026-08-05",
  "a local-date rule would already be on the 6th in Kyiv"
);
check("previous day crosses month boundary", d.previousDateKey("2026-08-01") === "2026-07-31");
check("previous day crosses year boundary", d.previousDateKey("2026-01-01") === "2025-12-31");

// --- selection --------------------------------------------------------
const a1 = d.pickDailyLevel(levels, "2026-08-05");
const a2 = d.pickDailyLevel(levels, "2026-08-05");
check("same date always yields the same puzzle", a1.n === a2.n, "two players must get the identical grid");
check("picks from the hard pool", a1.tier === "hard");
check("different dates differ", d.pickDailyLevel(levels, "2026-08-06").n !== a1.n);

// The daily must be substantial as well as hard: a 9-word grid is over in
// about a minute and doesn't work as "today's puzzle", however rare its
// answers are.
check("never picks a tiny hard level", a1.words >= 18, `picked a ${a1.words}-word puzzle`);
const cycle = d.cycleLength(levels);
check("tiny hard levels are excluded from the pool", cycle === 10, `pool was ${cycle}, expected 12 minus the 2 tiny ones`);
let tinySeen = 0;
for (let i = 0; i < 40; i++) {
  const key = d.dailyDateKey(new Date(Date.parse("2026-08-05T00:00:00Z") + i * 86400000));
  if (d.pickDailyLevel(levels, key).words < 18) tinySeen++;
}
check("no tiny level appears across a full cycle", tinySeen === 0, `${tinySeen} tiny picks`);

// Degrades rather than failing when no level clears the size bar.
check(
  "falls back to hard tier if none are substantial",
  d.pickDailyLevel(levels.map((l) => ({ ...l, words: 5 })), "2026-08-05") !== null
);
const seen = new Set();
for (let i = 0; i < cycle; i++) {
  const key = d.dailyDateKey(new Date(Date.parse("2026-08-05T00:00:00Z") + i * 86400000));
  seen.add(d.pickDailyLevel(levels, key).n);
}
check("every puzzle used once before any repeat", seen.size === cycle, `got ${seen.size} distinct of ${cycle}`);
check(
  "wraps around after a full cycle",
  d.pickDailyLevel(levels, d.dailyDateKey(new Date(Date.parse("2026-08-05T00:00:00Z") + cycle * 86400000))).n === a1.n
);

// Falls back rather than returning nothing when no hard levels exist.
check("falls back to any tier if no hard levels", d.pickDailyLevel(levels.filter((l) => l.tier === "easy"), "2026-08-05") !== null);
check("empty ladder yields null, not a crash", d.pickDailyLevel([], "2026-08-05") === null);

// --- streaks ----------------------------------------------------------
d.resetDaily();
check("streak starts at zero", d.getDailyStreak() === 0);

let r = d.recordDailyResult("2026-08-05", { stars: 3, points: 100, timeSec: 60, completed: true });
check("first completion starts a streak at 1", r.streak === 1);

r = d.recordDailyResult("2026-08-05", { stars: 3, points: 500, timeSec: 40, completed: true });
check("replaying the same day does not inflate the streak", r.streak === 1, "otherwise a streak is just a refresh button");
check("but a better score is still kept", r.merged.points === 500);
check("and a better time is kept", r.merged.bestTimeSec === 40);

r = d.recordDailyResult("2026-08-06", { stars: 2, points: 200, timeSec: 90, completed: true });
check("consecutive day advances the streak", r.streak === 2);
check("a worse score does not overwrite the best", d.getDailyResult("2026-08-05").points === 500);

r = d.recordDailyResult("2026-08-09", { stars: 1, points: 50, timeSec: 200, completed: true });
check("a gap resets the streak to 1, not 0", r.streak === 1, "the completed day is itself day one of the new run");

r = d.recordDailyResult("2026-08-10", { stars: 0, points: 10, completed: false });
check("an unfinished attempt does not advance the streak", r.streak === 1);
check("an unfinished attempt records no time", d.getDailyResult("2026-08-10").bestTimeSec === null);

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log("  FAIL: " + f));
  process.exit(1);
}
