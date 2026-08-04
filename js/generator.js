// Orchestrates skeleton generation + word filling into a renderable puzzle
// model, retrying with fresh random skeletons when a fill attempt fails.

// Pure function of `words` - shared by live generation (buildPuzzleModel,
// below) and by loading a previously-saved puzzle back from JSON (a saved
// puzzle only needs to store rows/cols/isClue/words; clueCells is always
// exactly this computed from them, so there's no point saving it too).
function buildClueCells(words) {
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
  return clueCells;
}

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

  return { rows, cols, isClue, words, clueCells: buildClueCells(words) };
}

// Both stages are cheap individually (skeleton generation retries
// internally, and a single fillSlots call is fast even when it fails) but
// neither succeeds every time on its own, so the outer loop just keeps
// pairing fresh skeletons with fill attempts until one combination works
// or the time budget runs out.
//
// maxWordLen defaults to capping at 6 regardless of grid size (for grids
// big enough to fit longer words at all) - not a dictionary-thinness
// issue, the dictionary has 1000+ words at every length from 3 to 9.
// Measured directly: a 9x9 grid with words up to 9 letters failed to fill
// in 10/10 trials even with a 50000-node budget, but capping at 6 let the
// same size succeed in 9/10 trials in a few hundred ms. Each additional
// long slot multiplies the number of simultaneous crossing constraints
// the backtracking search has to satisfy at once, so a few long words per
// puzzle is fine but letting *most* slots go long makes the puzzle
// combinatorially unfillable in practice, independent of raw word supply.
// It's exposed as an option (not just hardcoded) because that tradeoff
// point shifts with how much time you're willing to spend: the offline
// batch generator trades wall-clock time for success rate in a way the
// live UI can't, so it's worth letting it try other values.
//
// async so it can yield back to the browser every ~100ms of work (via the
// setTimeout(0) below). Bigger grids can legitimately take 20-30s across
// many retries - without yielding, that's a fully synchronous block: no
// repaint (the "generating..." status never actually shows), no
// responsiveness, and browsers start offering to kill an unresponsive tab
// well before that. The yielding costs nothing when generation is fast
// (small grids resolve in well under one slice and never hit it).
async function generatePuzzle(
  rows,
  cols,
  dictionary,
  { timeBudgetMs = 8000, fillAttemptsPerSkeleton = 1, maxWordLen = Math.max(3, Math.min(6, Math.max(rows, cols))) } = {}
) {
  const deadline = Date.now() + timeBudgetMs;
  let sliceStart = Date.now();

  async function maybeYield() {
    if (Date.now() - sliceStart > 100) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = Date.now();
    }
  }

  while (Date.now() < deadline) {
    const skeleton = generateSkeleton(rows, cols, { maxWordLen }, 2000, deadline);
    if (!skeleton) {
      await maybeYield();
      continue;
    }

    for (let i = 0; i < fillAttemptsPerSkeleton && Date.now() < deadline; i++) {
      const fillResult = fillSlots(skeleton.slots, dictionary);
      if (fillResult) {
        return buildPuzzleModel(rows, cols, skeleton.isClue, skeleton.slots, fillResult);
      }
    }
    await maybeYield();
  }
  return null;
}
