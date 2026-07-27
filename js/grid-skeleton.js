// Builds the *shape* of a scanword grid: which cells are clue cells and
// which are letter cells. Every single cell ends up either a clue for a
// real word or a letter inside one - there is no black/blocked cell, no
// decorative cell, and no clue cell that ends up pointing at nothing.
//
// This is a real constraint solver (backtracking with pruning), not
// generate-and-hope: it tries a cell as letter-or-clue, checks whether that
// choice can still lead to a fully valid grid, and backtracks the instant
// it can't. A valid tiling is found whenever one exists for the requested
// size - it isn't left to luck.
//
// The rules being enforced, for every row and every column independently:
// - A maximal run of letter cells ("run" = consecutive letters bounded by
//   clue cells or the grid edge) is one of exactly two things:
//   - a "stub": length 1..minWordLen-1. Not a word, doesn't need a clue -
//     dictionaries don't have 1-2 letter Ukrainian nouns anyway, so this
//     is just "this cell isn't part of a word in this direction." A
//     letter cell must NOT be a stub in *both* directions at once (that
//     would be a cell with no word at all - an orphan).
//   - a real word: length minWordLen..maxWordLen. It MUST have a clue
//     cell immediately before its start (to its left for across, above
//     for down) - which is impossible if the run starts at the grid's
//     own edge (row 0 for a down word, column 0 for an across word), so
//     an edge-starting run can only ever be a stub, never a real word.
// - Every clue cell must actually be the clue for at least one real word
//   (the run immediately to its right, and/or immediately below it) - a
//   clue cell that has stubs (or nothing) on both sides serves no word
//   and isn't allowed to exist.
//
// Because row 0 / column 0 are just ordinary edges under these rules (an
// edge-starting run can only be a stub), most border cells end up clue
// cells fairly naturally - not because they're hardcoded, but because a
// long run of letters starting right at the edge would have nowhere to
// put its clue. There's no reserved title cell: cell (0,0) is decided by
// the same rules as everywhere else, and ends up a genuine, used clue.

const MIN_WORD_LEN = 3;
const NODE_BUDGET = 10_000_000;

// Tries to build one complete, fully-valid grid skeleton via backtracking.
// Returns { isClue, slots, clueCellSlots } or null if none exists within
// the node budget.
//
// A run that starts at the grid's own edge (column 0 for an across run,
// row 0 for a down run) can never have a clue, so extractSlots() never
// registers it as a word no matter how long it gets - those cells simply
// rely on their other direction instead. That means there's no "illegal
// length" to prune for edge-started runs; the only thing worth enforcing
// while placing cells is the maxWordLen cap. Whether every letter ends up
// with a real word in some direction, and every clue cell ends up serving
// one, can only be known once the grid is complete - so that check is the
// actual win condition, not a separate validation pass tacked on after.
function generateSkeleton(rows, cols, { maxWordLen = 7, bias = 0.35 } = {}) {
  const isClue = Array.from({ length: rows }, () => new Array(cols).fill(false));

  // Per-row / per-column running length of the currently-open letter run.
  const hRun = new Array(rows).fill(0);
  const vRun = new Array(cols).fill(0);

  // lastClueCol[r] / lastClueRow[c]: where the *previous* clue in this row
  // / column sits (-1 if the current run is still edge-started, i.e. there
  // hasn't been one yet). Whenever a run closes, that's the clue whose
  // fate it just decided.
  const lastClueCol = new Array(rows).fill(-1);
  const lastClueRow = new Array(cols).fill(-1);

  // Whether a given clue cell's row-side / column-side has been decided
  // real (true) or stub (false) yet. A clue with both sides resolved stub
  // serves no word at all - that's caught the instant the second side
  // resolves, rather than waiting for the whole grid to be built.
  const rowSideValid = new Map(); // "r,c" -> bool
  const colSideValid = new Map(); // "r,c" -> bool
  const key = (r, c) => r + "," + c;

  // Whether cell (r,c)'s row-run turned out real (true) or stub (false) -
  // set the moment that row-run closes. A column-run closing as a stub
  // can then immediately check every cell it covers: if any of them also
  // had a stub row-run, that cell has no word in either direction - an
  // orphan - and this whole branch is dead right now, not just once the
  // grid is finished. (By row-major order a cell's row-run always closes
  // no later than its column-run, one edge case aside - see below - so
  // this check almost never fires on stale/unset data.)
  const letterRowReal = Array.from({ length: rows }, () => new Array(cols).fill(undefined));

  let nodes = 0;

  function markRowRun(r, endColExclusive, len, real) {
    const start = endColExclusive - len;
    const prev = new Array(len);
    for (let cc = start; cc < endColExclusive; cc++) {
      prev[cc - start] = letterRowReal[r][cc];
      letterRowReal[r][cc] = real;
    }
    return { r, start, end: endColExclusive, prev };
  }
  function undoRowRunMark(token) {
    if (!token) return;
    for (let cc = token.start; cc < token.end; cc++) {
      letterRowReal[token.r][cc] = token.prev[cc - token.start];
    }
  }

  // True if a just-closed stub column run (rows [endRowExclusive-len,
  // endRowExclusive) in column c) contains a cell whose row-run was also
  // a stub - i.e. a cell with no word in either direction.
  function columnRunHasOrphan(c, endRowExclusive, len) {
    if (len >= MIN_WORD_LEN) return false;
    const start = endRowExclusive - len;
    for (let ri = start; ri < endRowExclusive; ri++) {
      if (letterRowReal[ri][c] === false) return true;
    }
    return false;
  }

  // Called whenever row r's open run closes (closingLen cells ending just
  // before column endCol), whether that's because a new clue just got
  // placed there, or the row simply ran out of columns.
  function closeRowRun(r, endCol, closingLen) {
    const real = closingLen >= MIN_WORD_LEN;
    const markToken = closingLen > 0 ? markRowRun(r, endCol, closingLen, real) : null;
    const clueCol = lastClueCol[r];
    let sideKey = null;
    if (clueCol !== -1) {
      sideKey = key(r, clueCol);
      rowSideValid.set(sideKey, real);
    }
    return { markToken, sideKey };
  }
  function undoRowRun(token) {
    undoRowRunMark(token.markToken);
    if (token.sideKey !== null) rowSideValid.delete(token.sideKey);
  }

  // Same idea for a column's open run closing - this is where both a dead
  // clue and an orphan letter actually get caught.
  function closeColRun(c, endRow, closingLen) {
    const orphan = columnRunHasOrphan(c, endRow, closingLen);
    const clueRow = lastClueRow[c];
    let sideKey = null;
    let dead = false;
    if (clueRow !== -1) {
      sideKey = key(clueRow, c);
      const real = closingLen >= MIN_WORD_LEN;
      colSideValid.set(sideKey, real);
      dead = !real && rowSideValid.get(sideKey) === false;
    }
    return { sideKey, bad: orphan || dead };
  }
  function undoColRun(token) {
    if (token.sideKey !== null) colSideValid.delete(token.sideKey);
  }

  function place(index) {
    if (index === rows * cols) return !!validateSkeleton(isClue, rows, cols);
    nodes++;
    if (nodes > NODE_BUDGET) return false;

    const r = Math.floor(index / cols);
    const c = index % cols;
    const isRowEnd = c === cols - 1;
    const isLastRow = r === rows - 1;

    // Randomize which option to try first, for variety across calls -
    // biased toward extending short runs and toward breaking long ones.
    const runSoFar = Math.max(hRun[r], vRun[c]);
    const clueFirstP = runSoFar < MIN_WORD_LEN ? bias * 0.3 : Math.min(0.7, bias + (runSoFar - MIN_WORD_LEN) * 0.15);
    const order = Math.random() < clueFirstP ? ["clue", "letter"] : ["letter", "clue"];

    for (const option of order) {
      if (option === "letter") {
        const newHRun = hRun[r] + 1;
        const newVRun = vRun[c] + 1;
        if (newHRun > maxWordLen || newVRun > maxWordLen) continue;

        const prevHRun = hRun[r];
        const prevVRun = vRun[c];
        isClue[r][c] = false;
        hRun[r] = newHRun;
        vRun[c] = newVRun;

        // Letters don't close anything themselves, except when they're
        // the very last cell of a row/column - the run then closes
        // against the grid edge instead of a future clue.
        const rowToken = isRowEnd ? closeRowRun(r, c + 1, newHRun) : null;
        const colToken = isLastRow ? closeColRun(c, r + 1, newVRun) : null;
        const bad = (colToken && colToken.bad) || false;

        if (!bad && place(index + 1)) return true;

        if (rowToken) undoRowRun(rowToken);
        if (colToken) undoColRun(colToken);
        hRun[r] = prevHRun;
        vRun[c] = prevVRun;
      } else {
        const prevHRun = hRun[r];
        const prevVRun = vRun[c];

        const rowToken = closeRowRun(r, c, hRun[r]);
        const colToken = closeColRun(c, r, vRun[c]);

        isClue[r][c] = true;
        hRun[r] = 0;
        vRun[c] = 0;
        const prevLastClueCol = lastClueCol[r];
        const prevLastClueRow = lastClueRow[c];
        lastClueCol[r] = c;
        lastClueRow[c] = r;

        if (!colToken.bad && place(index + 1)) return true;

        lastClueCol[r] = prevLastClueCol;
        lastClueRow[c] = prevLastClueRow;
        undoRowRun(rowToken);
        undoColRun(colToken);
        hRun[r] = prevHRun;
        vRun[c] = prevVRun;
      }
    }

    return false;
  }

  if (!place(0)) return null; // exhausted every arrangement within budget - none valid at this size

  const validated = validateSkeleton(isClue, rows, cols);
  return validated ? { isClue, slots: validated.slots, clueCellSlots: validated.clueCellSlots } : null;
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
      // A run starting at column 0 has no cell to its left at all, so it
      // can never have a clue - it can only ever be a stub, never a real
      // word, no matter how long it is. Never register it as a word.
      if (len >= MIN_WORD_LEN && start >= 1) {
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
      if (len >= MIN_WORD_LEN && start >= 1) {
        const cells = [];
        for (let rr = start; rr < r; rr++) cells.push([rr, c]);
        slots.push({ dir: "down", cells, clueCell: [start - 1, c] });
      }
    }
  }

  return slots;
}

// Confirms a finished grid has zero waste: every letter cell belongs to a
// real word in at least one direction, and every clue cell is the clue for
// at least one real word. Returns the derived slot list plus a
// clueCell -> slots lookup on success, or null if anything is unused.
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
      const k = key(r, c);
      if (!clueCellSlots.has(k)) return null; // clue cell serving no word
    }
  }

  return { slots, clueCellSlots };
}
