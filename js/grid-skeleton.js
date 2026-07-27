// Builds the *shape* of a scanword grid: which cells are clue cells and
// which are letter cells, with no black/blocked cells anywhere.
//
// Convention (matches how real scanwords are laid out):
// - Row 0 and column 0 are always clue cells. This guarantees every word
//   that starts at row 1 / column 1 or later always has a clue cell
//   immediately above (down words) or to the left (across words).
// - Interior clue cells are sprinkled in to break long rows/columns into
//   word-length runs. A single interior clue cell can end up serving BOTH
//   an across word (starting immediately to its right) and a down word
//   (starting immediately below it) - that's fine and expected, it just
//   means that cell renders two clue lines instead of one.
// - A run of letter cells that's only 1 cell long in a given direction
//   simply isn't a word in that direction (no clue needed for it) - it's
//   normal for a letter cell to only be "used" by one of the two
//   directions.
//
// Generation is randomized generate-and-test: build one candidate layout,
// validate it, and retry with a new random layout if it's invalid. This
// is fast enough (a few hundred attempts take well under a second) that a
// perfect constraint solver isn't necessary.

// The dictionary has no 2-letter entries (crossword-viable short Ukrainian
// nouns essentially don't exist), so word slots must be at least 3 long -
// both when deciding where to break runs and when extracting slots below.
const MIN_WORD_LEN = 3;

function buildSkeletonCandidate(rows, cols, { minWordLen = MIN_WORD_LEN, maxWordLen = 7 } = {}) {
  const isClue = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let c = 0; c < cols; c++) isClue[0][c] = true;
  for (let r = 0; r < rows; r++) isClue[r][0] = true;

  const hRun = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const vRun = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let r = 1; r < rows; r++) {
    for (let c = 1; c < cols; c++) {
      const leftRun = isClue[r][c - 1] ? 0 : hRun[r][c - 1];
      const upRun = isClue[r - 1][c] ? 0 : vRun[r - 1][c];

      const forceClue = leftRun >= maxWordLen || upRun >= maxWordLen;
      let clue = forceClue;

      if (!forceClue) {
        // Bias toward longer runs than the bare minimum: breaking right at
        // minWordLen would flood the grid with short words, which need far
        // more distinct dictionary entries per cell of grid than a handful
        // of longer, well-crossed words do. Give runs room to grow toward
        // the middle of the length range before a break becomes likely.
        const runSoFar = Math.max(leftRun, upRun);
        let p;
        if (runSoFar < minWordLen - 1) {
          p = 0.05;
        } else {
          // Break fairly aggressively once the minimum length is reached,
          // so runs don't default to filling all remaining space with one
          // long word: that produces many same-length slots per grid,
          // which is a much tighter simultaneous-crossing constraint than
          // a mix of lengths for a dictionary this size to satisfy.
          p = Math.min(0.65, 0.25 + (runSoFar - (minWordLen - 1)) * 0.2);
        }
        clue = Math.random() < p;
      }

      isClue[r][c] = clue;
      hRun[r][c] = clue ? 0 : leftRun + 1;
      vRun[r][c] = clue ? 0 : upRun + 1;
    }
  }

  return isClue;
}

function extractSlots(isClue, rows, cols) {
  const slots = [];

  // Across words.
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (isClue[r][c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < cols && !isClue[r][c]) c++;
      const len = c - start;
      if (len >= MIN_WORD_LEN) {
        const cells = [];
        for (let cc = start; cc < c; cc++) cells.push([r, cc]);
        slots.push({ dir: "across", cells, clueCell: [r, start - 1] });
      }
    }
  }

  // Down words.
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (isClue[r][c]) {
        r++;
        continue;
      }
      const start = r;
      while (r < rows && !isClue[r][c]) r++;
      const len = r - start;
      if (len >= MIN_WORD_LEN) {
        const cells = [];
        for (let rr = start; rr < r; rr++) cells.push([rr, c]);
        slots.push({ dir: "down", cells, clueCell: [start - 1, c] });
      }
    }
  }

  return slots;
}

// Rejects skeletons that have orphan letter cells (part of no word at all)
// or clue cells that serve no word (dead decoration), and returns the
// derived slot list plus a clueCell -> slots lookup on success.
function validateSkeleton(isClue, rows, cols) {
  const slots = extractSlots(isClue, rows, cols);
  if (slots.length === 0) return null;

  const cellUsedByDir = new Map(); // "r,c" -> { across: bool, down: bool }
  const key = (r, c) => r + "," + c;

  slots.forEach((slot) => {
    slot.cells.forEach(([r, c]) => {
      const k = key(r, c);
      const entry = cellUsedByDir.get(k) || { across: false, down: false };
      entry[slot.dir] = true;
      cellUsedByDir.set(k, entry);
    });
  });

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isClue[r][c]) continue;
      const used = cellUsedByDir.get(key(r, c));
      if (!used || (!used.across && !used.down)) return null; // orphan letter
    }
  }

  const clueCellSlots = new Map(); // "r,c" -> [slot, ...]
  slots.forEach((slot) => {
    const k = key(slot.clueCell[0], slot.clueCell[1]);
    if (!clueCellSlots.has(k)) clueCellSlots.set(k, []);
    clueCellSlots.get(k).push(slot);
  });

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isClue[r][c]) continue;
      if (r === 0 || c === 0) continue; // border cells may end up unused - see app.js rendering note
      const k = key(r, c);
      if (!clueCellSlots.has(k)) return null; // dead interior clue cell
    }
  }

  return { slots, clueCellSlots };
}

function generateSkeleton(rows, cols, opts = {}, maxAttempts = 300) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isClue = buildSkeletonCandidate(rows, cols, opts);
    const validated = validateSkeleton(isClue, rows, cols);
    if (validated) {
      return { isClue, slots: validated.slots, clueCellSlots: validated.clueCellSlots };
    }
  }
  return null;
}
