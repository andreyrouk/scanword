// Orchestrates skeleton generation + word filling into a renderable puzzle
// model, retrying with fresh random skeletons when a fill attempt fails.

function buildPuzzleModel(rows, cols, isClue, slots, fillResult) {
  const words = slots.map((slot, i) => {
    const entry = fillResult.assignment.get(slot);
    return {
      id: "w" + i,
      dir: slot.dir,
      cells: slot.cells,
      clueCell: slot.clueCell,
      answer: entry.word,
      clue: entry.clue,
    };
  });

  const clueCells = new Map(); // "r,c" -> [{ dir, text, wordId }]
  words.forEach((w) => {
    const k = w.clueCell[0] + "," + w.clueCell[1];
    if (!clueCells.has(k)) clueCells.set(k, []);
    clueCells.get(k).push({ dir: w.dir, text: w.clue, wordId: w.id });
  });

  // In a dual-purpose clue cell, show the across (row) clue above the down
  // (column) clue - matches normal left-to-right, top-to-bottom reading
  // flow. This is independent of which word wins the first click on a
  // crossing letter cell (that's handled separately, in app.js).
  clueCells.forEach((list) => list.sort((a, b) => (a.dir === "across" ? -1 : 1)));

  return { rows, cols, isClue, words, clueCells };
}

// What fraction of letter cells belong to two words (are crossed) rather
// than just one. A valid skeleton with almost no crossing is technically
// fine (every cell still has a real word in some direction) but doesn't
// look like a real scanword, which interlocks densely - a skeleton search
// that just accepts the first valid layout it finds has no reason to
// prefer one over the other, so it needs to be told to.
function crossingFraction(slots) {
  const counts = new Map();
  slots.forEach((slot) => slot.cells.forEach(([r, c]) => {
    const k = r + "," + c;
    counts.set(k, (counts.get(k) || 0) + 1);
  }));
  const total = counts.size;
  if (total === 0) return 0;
  let crossing = 0;
  counts.forEach((n) => { if (n > 1) crossing++; });
  return crossing / total;
}

// Finding a *shape* that wastes nothing (see grid-skeleton.js) is a real
// constraint search and gets more expensive fast as grid area grows - much
// more expensive than filling dictionary words into a shape once it's
// found. So: sample a handful of valid skeletons, keep the most densely
// crossed one, then retry word-filling against it several times
// (fillSlots re-shuffles candidates each call) before paying for a brand
// new batch of skeletons. Bigger grids can fit longer words, so the max
// word length scales with grid size instead of staying fixed.
function generatePuzzle(
  rows,
  cols,
  dictionary,
  { timeBudgetMs = 12000, fillAttemptsPerSkeleton = 6, maxSkeletonCandidates = 6 } = {}
) {
  const deadline = Date.now() + timeBudgetMs;
  const maxWordLen = Math.max(3, Math.min(15, Math.max(rows, cols)));

  while (Date.now() < deadline) {
    // Sample a few valid skeletons and keep the most densely-crossed one -
    // but cap how long that sampling itself is allowed to eat into the
    // budget, since a single skeleton search can be cheap (small grids) or
    // expensive (large ones), and either way word-filling still needs its
    // own share of whatever time is left.
    const sampleDeadline = Math.min(deadline, Date.now() + timeBudgetMs * 0.25);
    let best = null;
    let bestFraction = -1;
    for (let i = 0; i < maxSkeletonCandidates && Date.now() < sampleDeadline; i++) {
      const candidate = generateSkeleton(rows, cols, { maxWordLen });
      if (!candidate) continue;
      const fraction = crossingFraction(candidate.slots);
      if (fraction > bestFraction) {
        best = candidate;
        bestFraction = fraction;
      }
      if (bestFraction === 1) break; // can't do better than fully crossed
    }
    if (!best) continue;

    for (let i = 0; i < fillAttemptsPerSkeleton && Date.now() < deadline; i++) {
      const fillResult = fillSlots(best.slots, dictionary);
      if (fillResult) {
        return buildPuzzleModel(rows, cols, best.isClue, best.slots, fillResult);
      }
    }
  }
  return null;
}
