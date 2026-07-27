// Builds the *shape* of a scanword grid: which cells are clue cells and
// which are letter cells.
//
// The rule that actually matters, for every row and every column
// independently: a maximal run of letter cells ("run" = consecutive
// letters bounded by clue cells or the grid edge) is one of exactly two
// things:
//   - a stub: length 1..minWordLen-1. Not a word, doesn't need a clue -
//     a cell in a stub relies entirely on its *other* direction having a
//     real word instead.
//   - a real word: length minWordLen..maxWordLen, with a clue cell
//     immediately before its start (to its left for across, above for
//     down) - impossible for a run starting at the grid's own edge (row
//     0 for a down word, column 0 for an across word), so an
//     edge-starting run can only ever be a stub. This is the rule that
//     actually matters for correctness: without it, a long run of
//     letters at the grid's edge can end up spelling nothing when read
//     straight through, which is the one thing a real scanword never
//     does.
//
// Every letter cell must end up with a real word in at least one
// direction (never a stub in both - that's an orphan, a cell nobody's
// clue explains). A clue cell serving zero real words (both sides
// falling to stubs) is rare but not treated as fatal here - see
// grid-clue-status in app.js for how those render instead of being
// banned outright, which would make grid generation dramatically less
// reliable for only a cosmetic gain.
//
// Generation is randomized generate-and-validate: build a candidate
// layout, keep it if it's valid, retry with a new random layout
// otherwise. Retrying is cheap (a single attempt is a fast O(rows*cols)
// pass) even though a *valid* layout is a small fraction of random ones,
// because most invalid attempts are rejected fast, long before the
// expensive full-grid check.

const MIN_WORD_LEN = 3;

function isValidClose(len, minWordLen, edgeStarted) {
  if (len === 0) return true;
  if (len < minWordLen) return true; // stub - always fine
  return !edgeStarted; // real word - needs a clue before it, so can't be edge-started
}

function buildSkeletonCandidate(rows, cols, { minWordLen = MIN_WORD_LEN, maxWordLen = 7, bias = 0.15 } = {}) {
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
        const runSoFar = Math.max(leftRun, upRun);
        let p;
        if (runSoFar < minWordLen - 1) {
          p = 0.05;
        } else {
          p = Math.min(0.6, bias + (runSoFar - (minWordLen - 1)) * 0.15);
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

// Walks every maximal run in both directions and turns the real ones
// (length >= MIN_WORD_LEN, with a real clue before them) into word slots.
// Returns null if *any* run is an illegal length for where it started -
// most notably a run starting at the grid's own edge that got long
// anyway.
function extractSlots(isClue, rows, cols) {
  const slots = [];
  let illegal = false;

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
      if (!isValidClose(len, MIN_WORD_LEN, start === 0)) {
        illegal = true;
      } else if (len >= MIN_WORD_LEN) {
        const cells = [];
        for (let cc = start; cc < c; cc++) cells.push([r, cc]);
        slots.push({ dir: "across", cells, clueCell: [r, start - 1] });
      }
    }
  }

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
      if (!isValidClose(len, MIN_WORD_LEN, start === 0)) {
        illegal = true;
      } else if (len >= MIN_WORD_LEN) {
        const cells = [];
        for (let rr = start; rr < r; rr++) cells.push([rr, c]);
        slots.push({ dir: "down", cells, clueCell: [start - 1, c] });
      }
    }
  }

  return illegal ? null : slots;
}

// Rejects skeletons with an orphan letter cell (part of no word at all in
// either direction) and returns the derived slot list plus a
// clueCell -> slots lookup on success. A clue cell serving zero real
// words is left in the result rather than rejected here - see the file
// header.
function validateSkeleton(isClue, rows, cols) {
  const slots = extractSlots(isClue, rows, cols);
  if (!slots || slots.length === 0) return null;

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

  return { slots, clueCellSlots };
}

function generateSkeleton(rows, cols, opts = {}, maxAttempts = 500) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isClue = buildSkeletonCandidate(rows, cols, opts);
    const validated = validateSkeleton(isClue, rows, cols);
    if (validated) {
      return { isClue, slots: validated.slots, clueCellSlots: validated.clueCellSlots };
    }
  }
  return null;
}
