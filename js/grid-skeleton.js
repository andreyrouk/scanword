// Builds the *shape* of a scanword grid: which cells are clue cells and
// which are letter cells, and which clue cell explains which word.
//
// The key idea (how real scanwords actually do it): a word's clue does
// NOT have to sit directly before the word. The clue sits in a cell
// adjacent to the word's first letter, with a possibly-bent arrow
// showing where the word starts and which way it runs:
//   →  clue left of the start, word runs right
//   ↓  clue above the start, word runs down
//   ↳  clue above the start, word runs right
//   ↴  clue left of the start, word runs down
// That flexibility is what makes a fully-used grid possible at all -
// with rigid "clue directly before the word" placement it's provably
// impossible for many sizes.
//
// Construction is word-first, not mask-first: scan the grid row-major,
// and every cell not yet covered by a word becomes a clue cell that
// immediately grows one (sometimes two) words out of itself into the
// undecided space to the right/below. Because words only ever come into
// existence attached to their clue, the hard guarantees hold by
// construction, not by luck:
// - every letter cell is part of at least one real word,
// - every clue cell explains one or two words - never zero,
// - every maximal run of letters is either a single crossing letter or
//   exactly one placed word: run boundaries are pinned when the word is
//   placed (the cells before/after it are reserved as future clue
//   cells), and a letter may never extend a perpendicular run that
//   isn't its own word - so nothing on the grid ever looks like a word
//   without being one.

const MIN_WORD_LEN = 3;

const ARROWS = {
  acrossLeft: { glyph: "→", edge: "right", flip: false },
  acrossAbove: { glyph: "↳", edge: "bottom", flip: false },
  downAbove: { glyph: "↓", edge: "bottom", flip: false },
  downLeft: { glyph: "↴", edge: "right", flip: false },
};

// Word-length preference, roughly matching what the dictionary can serve.
const LEN_WEIGHTS = { 3: 1, 4: 1.2, 5: 1.2, 6: 0.9, 7: 0.7, 8: 0.4, 9: 0.25 };

function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function tryBuild(rows, cols, maxWordLen, secondClueP) {
  const U = 0, L = 1, K = 2;
  const state = Array.from({ length: rows }, () => new Array(cols).fill(U));
  // hEnd/vEnd: if a cell is covered by an across/down word, the column/row
  // where that word ends; -1 otherwise. Used to tell real crossings from
  // stray letters, and to forbid overlapping same-direction words.
  const hEnd = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const vEnd = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  // Cells reserved as future clue cells (word boundaries): may never
  // become letters.
  const notL = new Set();
  const words = [];
  const kk = (r, c) => r + "," + c;

  function lenOrder(maxSpace) {
    const lens = [];
    for (let l = MIN_WORD_LEN; l <= Math.min(maxWordLen, maxSpace); l++) lens.push(l);
    return lens
      .map((l) => ({ l, key: Math.pow(Math.random(), 1 / (LEN_WEIGHTS[l] || 0.15)) }))
      .sort((a, b) => b.key - a.key)
      .map((x) => x.l);
  }

  function canPlaceAcross(r, cs, len) {
    const ce = cs + len - 1;
    if (ce > cols - 1) return false;
    if (cs - 1 >= 0 && state[r][cs - 1] === L) return false; // would extend into an earlier run
    if (ce + 1 <= cols - 1 && state[r][ce + 1] === L) return false; // would merge with a later run
    for (let cc = cs; cc <= ce; cc++) {
      const st = state[r][cc];
      if (st === K || notL.has(kk(r, cc))) return false;
      if (hEnd[r][cc] !== -1) return false; // already inside another across word
      if (st === L) {
        if (vEnd[r][cc] === -1) return false; // letter but not a down-word crossing - never legal
      } else {
        // Fresh letter: the cells above/below must not already be letters
        // (a letter here would merge two vertical runs into gibberish; a
        // legal crossing would have made this cell a letter already).
        if (r - 1 >= 0 && state[r - 1][cc] === L) return false;
        if (r + 1 <= rows - 1 && state[r + 1][cc] === L) return false;
      }
    }
    return true;
  }

  function canPlaceDown(rs, c, len) {
    const re = rs + len - 1;
    if (re > rows - 1) return false;
    if (rs - 1 >= 0 && state[rs - 1][c] === L) return false;
    if (re + 1 <= rows - 1 && state[re + 1][c] === L) return false;
    for (let rr = rs; rr <= re; rr++) {
      const st = state[rr][c];
      if (st === K || notL.has(kk(rr, c))) return false;
      if (vEnd[rr][c] !== -1) return false;
      if (st === L) {
        if (hEnd[rr][c] === -1) return false;
      }
      // Note: no left/right adjacency check for fresh letters here - a
      // horizontally-adjacent letter may yet be legitimized by an across
      // word placed later (rows below the scan frontier aren't final).
      // Bad rows are caught by the row-completion audit in solve().
    }
    return true;
  }

  // Placements are undoable so the scan can backtrack: a greedy
  // no-return version of this construction dead-ends essentially always
  // (verified empirically) - the search needs to revise earlier
  // placements when a later cell can't grow a word.
  function place(dir, s0, s1, len, clueCell, arrowType) {
    const cells = [];
    const changed = [];
    const notLAdded = [];
    if (dir === "across") {
      const r = s0, cs = s1, ce = cs + len - 1;
      for (let cc = cs; cc <= ce; cc++) {
        changed.push({ r, c: cc, prevState: state[r][cc], prevH: hEnd[r][cc], prevV: vEnd[r][cc] });
        state[r][cc] = L;
        hEnd[r][cc] = ce;
        cells.push([r, cc]);
      }
      if (cs - 1 >= 0 && state[r][cs - 1] === U && !notL.has(kk(r, cs - 1))) { notL.add(kk(r, cs - 1)); notLAdded.push(kk(r, cs - 1)); }
      if (ce + 1 <= cols - 1 && state[r][ce + 1] === U && !notL.has(kk(r, ce + 1))) { notL.add(kk(r, ce + 1)); notLAdded.push(kk(r, ce + 1)); }
    } else {
      const rs = s0, c = s1, re = rs + len - 1;
      for (let rr = rs; rr <= re; rr++) {
        changed.push({ r: rr, c, prevState: state[rr][c], prevH: hEnd[rr][c], prevV: vEnd[rr][c] });
        state[rr][c] = L;
        vEnd[rr][c] = re;
        cells.push([rr, c]);
      }
      if (rs - 1 >= 0 && state[rs - 1][c] === U && !notL.has(kk(rs - 1, c))) { notL.add(kk(rs - 1, c)); notLAdded.push(kk(rs - 1, c)); }
      if (re + 1 <= rows - 1 && state[re + 1][c] === U && !notL.has(kk(re + 1, c))) { notL.add(kk(re + 1, c)); notLAdded.push(kk(re + 1, c)); }
    }
    words.push({ dir, cells, clueCell, arrow: ARROWS[arrowType] });
    return { changed, notLAdded };
  }

  function undoPlace(token) {
    words.pop();
    token.changed.forEach(({ r, c, prevState, prevH, prevV }) => {
      state[r][c] = prevState;
      hEnd[r][c] = prevH;
      vEnd[r][c] = prevV;
    });
    token.notLAdded.forEach((k) => notL.delete(k));
  }

  // All legal (variant, length) options for a clue cell at (r,c).
  function optionsFor(r, c) {
    const variants = [
      { type: "acrossLeft", dir: "across", sr: r, sc: c + 1 },
      { type: "acrossAbove", dir: "across", sr: r + 1, sc: c },
      { type: "downAbove", dir: "down", sr: r + 1, sc: c },
      { type: "downLeft", dir: "down", sr: r, sc: c + 1 },
    ];
    const opts = [];
    for (const v of variants) {
      if (v.sr > rows - 1 || v.sc > cols - 1) continue;
      const space = v.dir === "across" ? cols - v.sc : rows - v.sr;
      for (const len of lenOrder(space)) {
        if (v.dir === "across" ? canPlaceAcross(v.sr, v.sc, len) : canPlaceDown(v.sr, v.sc, len)) {
          // Prefer options that cross existing letters (they discharge
          // obligations) over ones that lay fresh letters next to
          // parallel words (they create obligations a future across
          // word must fix) - dramatically less backtracking.
          let score = 0;
          for (let i = 0; i < len; i++) {
            const rr = v.dir === "across" ? v.sr : v.sr + i;
            const cc = v.dir === "across" ? v.sc + i : v.sc;
            if (state[rr][cc] === L) score += 2;
            else if (v.dir === "down") {
              if ((cc - 1 >= 0 && state[rr][cc - 1] === L) || (cc + 1 <= cols - 1 && state[rr][cc + 1] === L)) score -= 1;
            }
          }
          opts.push({ ...v, len, key: score + Math.random() });
        }
      }
    }
    return opts.sort((a, b) => b.key - a.key);
  }

  let nodes = 0;
  const NODE_BUDGET = 25000;

  // Once the scan has fully passed a row, no future placement can touch
  // it - so its horizontal runs are final and must each be exactly one
  // across word (or a single crossing letter). Checking this the moment
  // a row completes prunes doomed branches within one row instead of at
  // the very end.
  function rowIsClean(r) {
    let c = 0;
    while (c < cols) {
      if (state[r][c] !== L) { c++; continue; }
      const start = c;
      const end = hEnd[r][c];
      if (end === -1) {
        if (c + 1 < cols && state[r][c + 1] === L) return false; // 2+ letters, no across word
        c++;
      } else {
        for (; c <= end; c++) if (hEnd[r][c] !== end) return false;
        if (end + 1 < cols && state[r][end + 1] === L) return false;
      }
      if (start - 1 >= 0 && state[r][start - 1] === L) return false;
    }
    return true;
  }

  function solve(index) {
    // Advance to the next undecided cell, auditing each row as it
    // becomes final.
    while (index < rows * cols) {
      const r = Math.floor(index / cols);
      const c = index % cols;
      if (c === 0 && r >= 1 && !rowIsClean(r - 1)) return false;
      if (state[r][c] === U) break;
      index++;
    }
    if (index === rows * cols) {
      for (let r = 0; r < rows; r++) if (!rowIsClean(r)) return false;
      return true;
    }
    if (++nodes > NODE_BUDGET) return false;

    const r = Math.floor(index / cols);
    const c = index % cols;
    const wasNotL = notL.delete(kk(r, c));
    state[r][c] = K;

    for (const opt of optionsFor(r, c).slice(0, 10)) {
      const t1 = place(opt.dir, opt.sr, opt.sc, opt.len, [r, c], opt.type);
      // Optionally grow a second word (other direction) out of the same
      // clue cell - best-effort, adds density, never a hard requirement.
      let t2 = null;
      if (Math.random() < secondClueP) {
        const second = optionsFor(r, c).find((o) => o.dir !== opt.dir);
        if (second) t2 = place(second.dir, second.sr, second.sc, second.len, [r, c], second.type);
      }
      if (solve(index + 1)) return true;
      if (t2) undoPlace(t2);
      undoPlace(t1);
    }

    state[r][c] = U;
    if (wasNotL) notL.add(kk(r, c));
    return false;
  }

  if (!solve(0)) return null;
  return { state, words };
}

// Independent audit used by generateSkeleton: recompute every maximal run
// from the finished mask and confirm each one is either a single crossing
// letter or exactly one placed word. Belt-and-suspenders - construction
// should guarantee this, but a generated puzzle must never ship broken.
function extractRuns(isClue, rows, cols) {
  const runs = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (isClue[r][c]) { c++; continue; }
      const start = c;
      while (c < cols && !isClue[r][c]) c++;
      if (c - start >= 2) runs.push({ dir: "across", r, c: start, len: c - start });
    }
  }
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (isClue[r][c]) { r++; continue; }
      const start = r;
      while (r < rows && !isClue[r][c]) r++;
      if (r - start >= 2) runs.push({ dir: "down", r: start, c, len: r - start });
    }
  }
  return runs;
}

// secondClueP defaults to 0: one word per clue cell. Two clues crammed
// into one cell leaves each of them too little room to be readable at
// puzzle scale, so it's not worth the extra density.
function generateSkeleton(rows, cols, { maxWordLen = 7, secondClueP = 0 } = {}, maxAttempts = 400) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const built = tryBuild(rows, cols, maxWordLen, secondClueP);
    if (!built) continue;

    const isClue = built.state.map((row) => row.map((s) => s === 2));

    // Audit: every run of 2+ letters must be exactly one placed word.
    const placedKey = new Set(
      built.words.map((w) => w.dir + ":" + w.cells[0][0] + "," + w.cells[0][1] + ":" + w.cells.length)
    );
    const runs = extractRuns(isClue, rows, cols);
    const clean =
      runs.length === built.words.length &&
      runs.every((run) => placedKey.has(run.dir + ":" + run.r + "," + run.c + ":" + run.len));
    if (!clean) continue;

    const clueCellSlots = new Map();
    built.words.forEach((w) => {
      const k = w.clueCell[0] + "," + w.clueCell[1];
      if (!clueCellSlots.has(k)) clueCellSlots.set(k, []);
      clueCellSlots.get(k).push(w);
    });
    return { isClue, slots: built.words, clueCellSlots };
  }
  return null;
}
