// The daily scanword: one puzzle per day, the same one for everybody.
//
// Selection is deterministic from the date, with no server involved - the
// whole point is that two players can compare results, which only works
// if they were handed the identical grid. A server is needed later to
// *rank* those results (and to stop people lying about them), not to
// decide what today's puzzle is.
//
// Dates are UTC, deliberately. A local-date rule would hand players in
// different timezones different puzzles at the same moment, which quietly
// breaks the leaderboard this is being built for - and this app expects a
// diaspora audience spread across many timezones, so that isn't a corner
// case. The cost is that the new puzzle lands at 02:00-03:00 Kyiv time
// rather than local midnight, which is a reasonable trade for everyone
// being on the same board.

const DAILY_KEY = "scanword.daily.v1";
const DAY_MS = 86400000;

function dailyDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD, already UTC
}

function previousDateKey(dateKey) {
  return dailyDateKey(new Date(Date.parse(dateKey + "T00:00:00Z") - DAY_MS));
}

function dayNumber(dateKey) {
  return Math.floor(Date.parse(dateKey + "T00:00:00Z") / DAY_MS);
}

// Small deterministic PRNG so the pool order is stable across devices and
// reloads without shipping a shuffled list as data.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL_SEED = 20260101;

// The daily wants a puzzle that is hard *and* substantial. Tier alone
// isn't enough: the ladder's difficulty score weights word rarity heavily,
// so a 9-word 6x6 built entirely from obscure answers lands in the hard
// third (positions 79-80 at time of writing) despite being over in about a
// minute. That's a defensible ladder ranking and a bad daily - "today's
// scanword" should feel like an event, so the pool also demands a real
// grid, not just a difficult one.
const MIN_DAILY_WORDS = 18;

function dailyPool(levels) {
  const hard = levels.filter((l) => l.tier === "hard");
  const substantial = hard.filter((l) => (l.words || 0) >= MIN_DAILY_WORDS);
  // Degrade rather than return nothing: a small or early-stage ladder
  // should still produce a daily puzzle.
  if (substantial.length) return substantial;
  if (hard.length) return hard;
  return levels;
}

// Walks a fixed shuffled order of the pool by day number rather than
// hashing each date independently: an independent hash re-rolls every day
// and will repeat a puzzle long before the pool is exhausted (birthday
// problem - with ~30 puzzles a repeat is likely within a week). Cycling a
// shuffled list guarantees every puzzle is used once before any repeats,
// so the cycle length is exactly the pool size.
function pickDailyLevel(levels, dateKey = dailyDateKey()) {
  const usable = dailyPool(levels);
  if (!usable.length) return null;

  const order = usable.slice();
  const rand = mulberry32(POOL_SEED);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  // Modulo of a possibly-negative day number would index backwards for
  // dates before the epoch; normalise so it can't.
  const idx = ((dayNumber(dateKey) % order.length) + order.length) % order.length;
  return order[idx];
}

function cycleLength(levels) {
  return dailyPool(levels).length;
}

// --- storage ----------------------------------------------------------
// Same degrade-to-memory approach as progress.js: losing a streak is
// annoying, breaking the game is not acceptable.
let dailyMemory = null;

function emptyDaily() {
  return { version: 1, streak: 0, lastCompletedDate: null, results: {} };
}

function readDaily() {
  if (dailyMemory) return dailyMemory;
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (!raw) return emptyDaily();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return emptyDaily();
    return parsed;
  } catch (err) {
    console.warn("daily: falling back to memory", err);
    dailyMemory = emptyDaily();
    return dailyMemory;
  }
}

function writeDaily(state) {
  if (dailyMemory) {
    dailyMemory = state;
    return;
  }
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("daily: storage unavailable, keeping in memory", err);
    dailyMemory = state;
  }
}

function getDailyResult(dateKey = dailyDateKey()) {
  return readDaily().results[dateKey] || null;
}

function getDailyStreak() {
  return readDaily().streak || 0;
}

// Best-of is kept per day. Note for when the leaderboard lands: a real
// competitive daily needs one scored attempt, and that has to be enforced
// server-side - a client can always be told to forget it already played.
// Keeping the best locally is the right behaviour for a solo player and
// deliberately does not pretend to be anti-cheat.
function recordDailyResult(dateKey, { stars = 0, points = 0, timeSec = null, hints = 0, completed = false }) {
  const state = readDaily();
  const prev = state.results[dateKey] || null;

  const merged = {
    stars: Math.max(prev ? prev.stars : 0, stars),
    points: Math.max(prev ? prev.points : 0, points),
    bestTimeSec:
      completed && timeSec !== null
        ? prev && prev.bestTimeSec !== null && prev.bestTimeSec !== undefined
          ? Math.min(prev.bestTimeSec, timeSec)
          : timeSec
        : prev
        ? prev.bestTimeSec
        : null,
    hints: completed ? (prev && prev.hints !== null && prev.hints !== undefined ? Math.min(prev.hints, hints) : hints) : prev ? prev.hints : null,
    completed: (prev && prev.completed) || completed,
  };

  const improved = !prev || merged.stars > prev.stars || merged.points > prev.points;
  state.results[dateKey] = merged;

  // The streak advances once per day, on first completion. Replaying the
  // same day must not inflate it, and a gap resets it to 1 rather than 0 -
  // the day being completed is itself day one of the new run.
  if (completed && state.lastCompletedDate !== dateKey) {
    state.streak = state.lastCompletedDate === previousDateKey(dateKey) ? (state.streak || 0) + 1 : 1;
    state.lastCompletedDate = dateKey;
  }

  writeDaily(state);
  return { merged, improved, streak: state.streak };
}

function resetDaily() {
  dailyMemory = null;
  try {
    localStorage.removeItem(DAILY_KEY);
  } catch (err) {
    dailyMemory = emptyDaily();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    dailyDateKey,
    previousDateKey,
    pickDailyLevel,
    cycleLength,
    getDailyResult,
    getDailyStreak,
    recordDailyResult,
    resetDaily,
    DAILY_KEY,
  };
}
