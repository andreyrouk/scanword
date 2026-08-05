// Scoring: turns a finished (or abandoned) solve into points + stars.
//
// Stars and points intentionally coexist because they do different jobs:
//
//   stars  - a *communication* device. Three explicit, legible conditions
//            a player can aim at ("no hints, under par time"). Not derived
//            from the point total, because "score >= 80% of max" is not a
//            goal anyone can hold in their head mid-puzzle, whereas "don't
//            use hints" is.
//   points - a *ranking* device, continuous and fine-grained. The daily
//            leaderboard needs to separate two players who both went
//            3-stars; stars alone would tie almost everyone at the top.
//
// Both are computed from the same raw inputs, so they can never disagree
// about what happened - only about how precisely they describe it.
//
// Design constraints this formula is built around:
//  - Fair across puzzle sizes. Par time scales with word count, so an
//    11x11 isn't scored against a 6x6's clock.
//  - Slow-but-clean is never punished into the ground. Going over par
//    costs you the speed *bonus*; it never subtracts from what you earned.
//    A scanword audience skews older and casual, and a formula that
//    punishes deliberate play would be hostile to exactly the people most
//    likely to play this daily.
//  - Hints cost, but never catastrophically. A hinted word simply earns no
//    base points (self-balancing: a hint can't leave you worse off than
//    never solving the word) plus a small flat penalty so hint-spamming is
//    strictly worse than thinking.
//  - Explainable. A player should be able to read the breakdown and
//    understand exactly why they got what they got - hence scoreSolve
//    returning a `breakdown`, not just a number.

const SCORING = {
  POINTS_PER_WORD: 100, // base value of one word solved unaided
  COMPLETION_BONUS_PER_WORD: 25, // paid only on finishing the whole grid
  SECONDS_PER_WORD: 15, // "par" pace: read clue, think, type
  HINT_PENALTY: 25, // flat, on top of the hinted word earning no base
  SPEED_WEIGHT: 0.4, // speed bonus as a fraction of earned points
  SPEED_FACTOR_MAX: 1.5, // cap, so a 10-second finish can't run away with it
  // Multipliers reward choosing harder content. Deliberately modest -
  // base points already scale with word count, so this is a nudge, not
  // the main lever.
  DIFFICULTY_MULTIPLIER: { easy: 1, medium: 1.25, hard: 1.5, daily: 1.75 },
  // 2 stars tolerates a few hints, scaled to puzzle size (a 30-word grid
  // can absorb more help than a 9-word one before it stops being "solved
  // well"). Floor of 1 so the smallest puzzles still have a middle band.
  TWO_STAR_HINT_ALLOWANCE: (wordCount) => Math.max(1, Math.round(wordCount * 0.15)),
  // 3 stars is about solving it *yourself*, not about racing. The time
  // gate is deliberately loose (1.5x par) so a deliberate solver still
  // earns full stars - it exists only to exclude walking away mid-puzzle,
  // not to punish thinking. Speed is what `points` is for; gating the
  // most visible feedback on it would be hostile to exactly the audience
  // most likely to play this daily. Tune THREE_STAR_PACE up to loosen.
  THREE_STAR_PACE: 1.5,
};

// Par time in seconds for a puzzle of this size. Exposed separately so the
// UI can show players the target they're racing before they start.
function parTimeSeconds(wordCount, config = SCORING) {
  return Math.max(1, wordCount) * config.SECONDS_PER_WORD;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// pace = elapsed / par. At or under par earns the full bonus; it decays to
// zero at twice par and never goes negative. Finishing well under par
// scales up to SPEED_FACTOR_MAX, which is what separates leaderboard
// entries that are all otherwise perfect.
function speedFactor(elapsedSeconds, parSeconds, config = SCORING) {
  if (!(elapsedSeconds > 0)) return config.SPEED_FACTOR_MAX; // guard /0 and absurd inputs
  const pace = elapsedSeconds / parSeconds;
  return clamp(2 - pace, 0, config.SPEED_FACTOR_MAX);
}

function starsFor({ completed, hintsUsed, elapsedSeconds, parSeconds, wordCount }, config = SCORING) {
  if (!completed) return 0;
  if (hintsUsed === 0 && elapsedSeconds <= parSeconds * config.THREE_STAR_PACE) return 3;
  if (hintsUsed <= config.TWO_STAR_HINT_ALLOWANCE(wordCount)) return 2;
  return 1;
}

// solvedUnaided: words the player got with no hint used anywhere in them.
// A hinted word is excluded from base points rather than penalised twice.
function scoreSolve(
  { wordCount, solvedUnaided, hintsUsed = 0, elapsedSeconds, difficulty = "easy", completed = null },
  config = SCORING
) {
  const totalWords = Math.max(0, wordCount);
  const unaided = clamp(solvedUnaided, 0, totalWords);
  // Default `completed` from the counts so callers can't silently disagree
  // with themselves, but allow an explicit override (a player can complete
  // a puzzle where some words were hinted, so unaided < wordCount).
  const isComplete = completed === null ? unaided >= totalWords && totalWords > 0 : completed;

  const parSeconds = parTimeSeconds(totalWords, config);
  const base = config.POINTS_PER_WORD * unaided;
  const completionBonus = isComplete ? config.COMPLETION_BONUS_PER_WORD * totalWords : 0;
  // No speed bonus on an unfinished puzzle: there's no meaningful "how
  // fast did you solve it" for something that wasn't solved.
  const speed = isComplete ? speedFactor(elapsedSeconds, parSeconds, config) : 0;
  const speedBonus = Math.round((base + completionBonus) * config.SPEED_WEIGHT * speed);
  const hintPenalty = config.HINT_PENALTY * hintsUsed;
  const multiplier = config.DIFFICULTY_MULTIPLIER[difficulty] ?? 1;

  const subtotal = base + completionBonus + speedBonus - hintPenalty;
  const points = Math.max(0, Math.round(subtotal * multiplier));

  const stars = starsFor(
    { completed: isComplete, hintsUsed, elapsedSeconds, parSeconds, wordCount: totalWords },
    config
  );
  // The speed flex, kept *separate* from stars on purpose: 3 stars stays
  // reachable for a deliberate solver, while "perfect" (clean AND under
  // par) gives faster players something to chase that doesn't devalue
  // anyone else's stars.
  const perfect = isComplete && hintsUsed === 0 && elapsedSeconds <= parSeconds;

  return {
    points,
    stars,
    perfect,
    parSeconds,
    breakdown: { base, completionBonus, speedBonus, hintPenalty, multiplier, speedFactor: speed },
  };
}

// Daily-puzzle streaks multiply the day's score. Capped so a long streak
// stays an advantage without making a newcomer's leaderboard position
// mathematically unreachable - if day 200 is worth 3x day 1, the board
// stops being a puzzle ranking and becomes a "who started earliest".
function streakMultiplier(streakDays) {
  return Math.min(1.5, 1 + Math.max(0, streakDays - 1) * 0.05);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SCORING, scoreSolve, parTimeSeconds, speedFactor, starsFor, streakMultiplier };
}
