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

  // Order dual-purpose clue cells so the down clue renders first, matching
  // the "vertical word wins the first click" interaction rule.
  clueCells.forEach((list) => list.sort((a, b) => (a.dir === "down" ? -1 : 1)));

  return { rows, cols, isClue, words, clueCells };
}

// How many distinct words a grid needs (and how many must share the exact
// same length and cross each other) scales with grid size much faster than
// the dictionary does. Small grids succeed almost immediately; larger ones
// may need many attempts or may not be satisfiable yet at all with a
// dictionary this size - hence a wall-clock budget rather than a fixed
// attempt count, so the UI never hangs regardless of grid size.
function generatePuzzle(rows, cols, dictionary, { timeBudgetMs = 4000 } = {}) {
  const deadline = Date.now() + timeBudgetMs;
  while (Date.now() < deadline) {
    const skeleton = generateSkeleton(rows, cols);
    if (!skeleton) continue;
    const fillResult = fillSlots(skeleton.slots, dictionary);
    if (fillResult) {
      return buildPuzzleModel(rows, cols, skeleton.isClue, skeleton.slots, fillResult);
    }
  }
  return null;
}
