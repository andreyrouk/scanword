// Assigns dictionary words to the word slots produced by grid-skeleton.js,
// respecting crossing letters, via backtracking search. Slots that share a
// cell must agree on the letter there.
//
// Uses a minimum-remaining-values (MRV) heuristic: at every step, fill in
// whichever unfilled slot currently has the fewest matching dictionary
// candidates, not a fixed length-based order. Fixing longest-first was
// tried and works badly here - it lets long words (few candidates, but
// enough) get chosen with no regard for what letters they pin down, then
// discovers only much later that a scarce short word's crossing letters
// got trampled, forcing large amounts of backtracking.

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fillSlots(slots, dictionary, { nodeBudget = 4000 } = {}) {
  const byLength = new Map();
  // byLengthPos[len][position] -> Map(letter -> entries at that length with
  // that letter at that position). Lets candidatesFor jump straight to a
  // small pre-filtered list once a slot has even one crossing letter fixed,
  // instead of re-scanning the whole (thousand-plus-word) length bucket at
  // every backtracking node - that rescan was the actual bottleneck on
  // bigger grids (dozens of slots, most sharing several fixed letters).
  const byLengthPos = new Map();
  dictionary.forEach((entry) => {
    const len = entry.word.length;
    if (!byLength.has(len)) {
      byLength.set(len, []);
      byLengthPos.set(len, Array.from({ length: len }, () => new Map()));
    }
    byLength.get(len).push(entry);
    const posMaps = byLengthPos.get(len);
    for (let i = 0; i < len; i++) {
      const ch = entry.word[i];
      if (!posMaps[i].has(ch)) posMaps[i].set(ch, []);
      posMaps[i].get(ch).push(entry);
    }
  });

  // Fail fast if some slot's length has zero dictionary candidates at all.
  for (const slot of slots) {
    if (!(byLength.get(slot.cells.length) || []).length) return null;
  }

  const key = (r, c) => r + "," + c;
  const usedWords = new Set();
  const letterAt = new Map(); // "r,c" -> letter
  const assignment = new Map(); // slot -> entry
  let nodes = 0;

  function candidatesFor(slot) {
    const len = slot.cells.length;
    const posMaps = byLengthPos.get(len);
    const fixed = [];
    for (let i = 0; i < len; i++) {
      const [r, c] = slot.cells[i];
      const letter = letterAt.get(key(r, c));
      if (letter) fixed.push([i, letter]);
    }

    let pool;
    if (fixed.length === 0) {
      pool = byLength.get(len) || [];
    } else {
      // Start from whichever fixed position has the smallest indexed list,
      // then filter that (already small) list by the rest of the fixed
      // letters instead of touching the full length bucket at all.
      let best = null;
      for (const [i, letter] of fixed) {
        const list = posMaps[i].get(letter) || [];
        if (best === null || list.length < best.length) best = list;
      }
      pool = fixed.length === 1 ? best : best.filter((entry) => fixed.every(([i, letter]) => entry.word[i] === letter));
    }

    return pool.filter((entry) => !usedWords.has(entry.word));
  }

  function backtrack(remaining) {
    if (remaining.length === 0) return true;
    nodes++;
    if (nodes > nodeBudget) return false;

    let bestIdx = 0;
    let bestCandidates = null;
    for (let i = 0; i < remaining.length; i++) {
      const candidates = candidatesFor(remaining[i]);
      if (candidates.length === 0) {
        return false; // this branch is dead regardless of other slots
      }
      if (bestCandidates === null || candidates.length < bestCandidates.length) {
        bestCandidates = candidates;
        bestIdx = i;
      }
    }

    const slot = remaining[bestIdx];
    const rest = remaining.slice(0, bestIdx).concat(remaining.slice(bestIdx + 1));

    for (const entry of shuffle(bestCandidates)) {
      assignment.set(slot, entry);
      usedWords.add(entry.word);
      const placedKeys = [];
      slot.cells.forEach(([r, c], i) => {
        const k = key(r, c);
        if (!letterAt.has(k)) {
          letterAt.set(k, entry.word[i]);
          placedKeys.push(k);
        }
      });

      if (backtrack(rest)) return true;

      assignment.delete(slot);
      usedWords.delete(entry.word);
      placedKeys.forEach((k) => letterAt.delete(k));
    }
    return false;
  }

  const ok = backtrack(slots);
  return ok ? { assignment, letterAt } : null;
}
