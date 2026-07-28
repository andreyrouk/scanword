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
      arrow: slot.arrow,
      answer: entry.word,
      clue: entry.clue,
    };
  });

  const clueCells = new Map(); // "r,c" -> [{ dir, text, wordId, arrow }]
  words.forEach((w) => {
    const k = w.clueCell[0] + "," + w.clueCell[1];
    if (!clueCells.has(k)) clueCells.set(k, []);
    clueCells.get(k).push({ dir: w.dir, text: w.clue, wordId: w.id, arrow: w.arrow });
  });

  // In a dual-purpose clue cell, show the across (row) clue above the down
  // (column) clue - matches normal left-to-right, top-to-bottom reading
  // flow. This is independent of which word wins the first click on a
  // crossing letter cell (that's handled separately, in app.js).
  clueCells.forEach((list) => list.sort((a, b) => (a.dir === "across" ? -1 : 1)));

  return { rows, cols, isClue, words, clueCells };
}

// Both stages are cheap individually (skeleton generation retries
// internally, and a single fillSlots call is fast even when it fails) but
// neither succeeds every time on its own, so the outer loop just keeps
// pairing fresh skeletons with fill attempts until one combination works
// or the time budget runs out. Bigger grids can fit longer words, so the
// max word length scales with grid size instead of staying fixed.
function generatePuzzle(rows, cols, dictionary, { timeBudgetMs = 8000, fillAttemptsPerSkeleton = 1 } = {}) {
  const deadline = Date.now() + timeBudgetMs;
  // Cap word length by what the dictionary can actually serve (it thins
  // out fast past 9 letters), not just by grid size.
  const maxWordLen = Math.max(3, Math.min(9, Math.max(rows, cols)));

  while (Date.now() < deadline) {
    const skeleton = generateSkeleton(rows, cols, { maxWordLen });
    if (!skeleton) continue;

    for (let i = 0; i < fillAttemptsPerSkeleton && Date.now() < deadline; i++) {
      const fillResult = fillSlots(skeleton.slots, dictionary);
      if (fillResult) {
        return buildPuzzleModel(rows, cols, skeleton.isClue, skeleton.slots, fillResult);
      }
    }
  }
  return null;
}
