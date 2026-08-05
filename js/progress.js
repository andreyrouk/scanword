// Campaign progress: which ladder levels are done, and how well.
//
// localStorage only, deliberately. Everything the campaign needs (stars,
// best score, best time, unlock state) is per-device data that no server
// has to arbitrate - so this whole feature ships with no accounts, no
// backend, and no network. Only the *daily leaderboard* genuinely needs a
// server, because that's the one place players' results are compared to
// each other and therefore worth cheating at.
//
// A best result is kept per field rather than per attempt: stars, points
// and time can each come from a different run (a cautious no-hint solve
// earns the stars, a later confident replay sets the time). Showing a
// player the best of each is what they'd expect from "your record".

const PROGRESS_KEY = "scanword.progress.v1";

function emptyProgress() {
  return { version: 1, levels: {} };
}

// localStorage throws rather than no-ops in Safari private mode and when
// the origin's quota is exhausted. Progress is a nice-to-have, never a
// reason to break the game, so every access degrades to in-memory.
let memoryFallback = null;

function readProgress() {
  if (memoryFallback) return memoryFallback;
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.levels !== "object") return emptyProgress();
    return parsed;
  } catch (err) {
    console.warn("progress: falling back to memory", err);
    memoryFallback = emptyProgress();
    return memoryFallback;
  }
}

function writeProgress(p) {
  if (memoryFallback) {
    memoryFallback = p;
    return;
  }
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch (err) {
    console.warn("progress: storage unavailable, keeping in memory", err);
    memoryFallback = p;
  }
}

function getLevelProgress(n) {
  return readProgress().levels[String(n)] || null;
}

// Returns the merged record so a caller can immediately show "new best".
function recordLevelResult(n, { stars = 0, points = 0, timeSec = null, hints = 0, completed = false }) {
  const p = readProgress();
  const key = String(n);
  const prev = p.levels[key] || { stars: 0, points: 0, bestTimeSec: null, hints: null, completed: false };

  const merged = {
    stars: Math.max(prev.stars, stars),
    points: Math.max(prev.points, points),
    // Only completed runs set a time - a partial attempt's clock isn't a
    // record of anything.
    bestTimeSec:
      completed && timeSec !== null ? (prev.bestTimeSec === null ? timeSec : Math.min(prev.bestTimeSec, timeSec)) : prev.bestTimeSec,
    hints: completed ? (prev.hints === null ? hints : Math.min(prev.hints, hints)) : prev.hints,
    completed: prev.completed || completed,
  };

  p.levels[key] = merged;
  writeProgress(p);
  return { merged, improved: merged.stars > prev.stars || merged.points > prev.points };
}

function totalStars() {
  const p = readProgress();
  return Object.values(p.levels).reduce((sum, l) => sum + (l.stars || 0), 0);
}

function completedCount() {
  const p = readProgress();
  return Object.values(p.levels).filter((l) => l.completed).length;
}

// Sequential unlock: finishing a level opens the next one. Kept simple and
// predictable rather than star-gated - a star gate can strand a player who
// finished everything but can't hit the threshold, which in a puzzle game
// reads as punishment rather than challenge.
function isUnlocked(n) {
  if (n <= 1) return true;
  const prev = getLevelProgress(n - 1);
  return !!(prev && prev.completed);
}

function highestUnlocked(total) {
  let n = 1;
  while (n < total && isUnlocked(n + 1)) n++;
  return n;
}

function resetProgress() {
  memoryFallback = null;
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch (err) {
    memoryFallback = emptyProgress();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getLevelProgress, recordLevelResult, totalStars, completedCount, isUnlocked, highestUnlocked, resetProgress, PROGRESS_KEY };
}
