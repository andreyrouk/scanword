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

function fillSlots(slots, dictionary, { nodeBudget = 20000 } = {}) {
  const byLength = new Map();
  dictionary.forEach((entry) => {
    const len = entry.word.length;
    if (!byLength.has(len)) byLength.set(len, []);
    byLength.get(len).push(entry);
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
    const pool = byLength.get(slot.cells.length) || [];
    return pool.filter((entry) => {
      if (usedWords.has(entry.word)) return false;
      for (let i = 0; i < slot.cells.length; i++) {
        const [r, c] = slot.cells[i];
        const existing = letterAt.get(key(r, c));
        if (existing && existing !== entry.word[i]) return false;
      }
      return true;
    });
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
