// Rendering + interaction layer. The interaction mechanic (click a clue to
// select its word, click a crossing cell to toggle between its two words,
// typing advances and skips locked cells, completed words lock) is adapted
// directly from the original interaction prototype, generalized to work
// with any grid size and with clue cells that may serve one or two words.

const key = (r, c) => r + "-" + c;

let puzzle = null;
let cellEls = {};
let inputEls = {};
let cellWordsMap = {}; // key -> [wordId, ...] (letter cells only)
let wordById = {};
let activeWordId = null;
let focusedKey = null;
let lockedWords = new Set();
let lockedCells = new Set();
let puzzleSolved = false; // guards the completion pulse so it fires once per puzzle

// --- solve session state (feeds js/scoring.js on completion) ----------
let hintsUsed = 0;
let hintedWords = new Set(); // word ids that received a hint - excluded from "unaided"
let currentDifficulty = "easy";
// The clock accumulates across pause/resume rather than being a single
// start timestamp, so leaving the tab doesn't inflate the solve time.
let elapsedMs = 0;
let runningSince = null;
let tickHandle = null;

const gridEl = document.getElementById("grid");
const statusEl = document.getElementById("status");
const rowsInput = document.getElementById("rowsInput");
const colsInput = document.getElementById("colsInput");
const statsbarEl = document.getElementById("statsbar");
const timerValueEl = document.getElementById("timerValue");
const parValueEl = document.getElementById("parValue");
const hintsValueEl = document.getElementById("hintsValue");
const resultsEl = document.getElementById("results");

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function elapsedSeconds() {
  const live = runningSince === null ? 0 : Date.now() - runningSince;
  return (elapsedMs + live) / 1000;
}

function startTimer() {
  if (runningSince !== null) return;
  runningSince = Date.now();
  if (tickHandle === null) tickHandle = setInterval(updateStats, 1000);
}

function pauseTimer() {
  if (runningSince === null) return;
  elapsedMs += Date.now() - runningSince;
  runningSince = null;
}

function stopTimer() {
  pauseTimer();
  if (tickHandle !== null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function resetTimer() {
  stopTimer();
  elapsedMs = 0;
}

// A puzzle left open in a background tab shouldn't accrue solve time -
// that would be indistinguishable from a slow solve and would quietly
// wreck both the player's score and, later, the leaderboard.
document.addEventListener("visibilitychange", () => {
  if (!puzzle || puzzleSolved) return;
  if (document.hidden) pauseTimer();
  else startTimer();
});

function updateStats() {
  if (!puzzle) return;
  const secs = elapsedSeconds();
  timerValueEl.textContent = formatTime(secs);
  const par = parTimeSeconds(puzzle.words.length);
  timerValueEl.classList.toggle("over-par", secs > par);
  hintsValueEl.textContent = String(hintsUsed);
}

function clearHighlights() {
  Object.values(cellEls).forEach((div) => div.classList.remove("highlight", "focused", "active"));
}

function selectWord(wordId, focusFirst) {
  activeWordId = wordId;
  clearHighlights();
  const w = wordById[wordId];
  w.cells.forEach(([r, c]) => cellEls[key(r, c)].classList.add("highlight"));
  const clueKey = key(w.clueCell[0], w.clueCell[1]);
  if (cellEls[clueKey]) cellEls[clueKey].classList.add("active");
  if (focusFirst) {
    const firstEditable = w.cells.map(([r, c]) => key(r, c)).find((k) => !lockedCells.has(k));
    if (firstEditable) focusCell(firstEditable);
  }
}

function focusCell(k) {
  if (focusedKey && cellEls[focusedKey]) cellEls[focusedKey].classList.remove("focused");
  focusedKey = k;
  cellEls[k].classList.add("focused");
  inputEls[k].focus();
  inputEls[k].select();
}

function handleCellClick(k) {
  const ids = cellWordsMap[k];
  if (ids.length === 1) {
    selectWord(ids[0], false);
    focusCell(k);
    return;
  }
  if (activeWordId && ids.includes(activeWordId) && focusedKey === k) {
    const otherId = ids.find((id) => id !== activeWordId);
    selectWord(otherId, false);
  } else {
    selectWord(ids[0], false);
  }
  focusCell(k);
}

function nextEditableInWord(wordId, fromKey) {
  const w = wordById[wordId];
  const keys = w.cells.map(([r, c]) => key(r, c));
  const idx = keys.indexOf(fromKey);
  for (let i = idx + 1; i < keys.length; i++) {
    if (!lockedCells.has(keys[i])) return keys[i];
  }
  return null;
}

function handleInput(e, k) {
  if (lockedCells.has(k)) {
    e.target.value = e.target.dataset.letter;
    return;
  }
  let val = e.target.value.replace(/[^a-zA-Zа-яА-ЯіІїЇєЄґҐ'ʼ]/g, "").slice(-1).toUpperCase();
  e.target.value = val;
  if (!val) return;
  checkWordCompletion();
  if (activeWordId) {
    const next = nextEditableInWord(activeWordId, k);
    if (next) focusCell(next);
  }
}

function handleKeydown(e, k) {
  if (lockedCells.has(k)) {
    if (e.key !== "Tab") e.preventDefault();
    return;
  }
  if (e.key === "Backspace" && !inputEls[k].value && activeWordId) {
    const w = wordById[activeWordId];
    const keys = w.cells.map(([r, c]) => key(r, c));
    const idx = keys.indexOf(k);
    for (let i = idx - 1; i >= 0; i--) {
      if (!lockedCells.has(keys[i])) {
        focusCell(keys[i]);
        inputEls[keys[i]].value = "";
        break;
      }
    }
    e.preventDefault();
  }
}

function checkWordCompletion() {
  puzzle.words.forEach((w) => {
    if (lockedWords.has(w.id)) return;
    const keys = w.cells.map(([r, c]) => key(r, c));
    const current = keys.map((kk) => inputEls[kk].value).join("");
    if (current.length === w.answer.length && current === w.answer) {
      lockedWords.add(w.id);
      keys.forEach((kk, i) => {
        lockedCells.add(kk);
        inputEls[kk].dataset.letter = w.answer[i];
        cellEls[kk].classList.add("locked", "just-locked");
        cellEls[kk].classList.remove("highlight", "focused");
        // Transient - .just-locked only exists to trigger the CSS pop
        // animation once, then gets out of the way so re-rendering that
        // cell for any other reason doesn't replay it.
        setTimeout(() => cellEls[kk].classList.remove("just-locked"), 320);
      });
      // Solving the word you were on clears the selection: nothing is
      // left highlighted for a word that's already done.
      if (activeWordId === w.id) {
        clearHighlights();
        activeWordId = null;
        focusedKey = null;
        if (document.activeElement) document.activeElement.blur();
      }
    }
  });

  // Fires the moment the last word locks, typing or not - a player
  // shouldn't have to remember to press "Перевірити" just to be told they
  // already won.
  if (!puzzleSolved && puzzle.words.length > 0 && lockedWords.size === puzzle.words.length) {
    puzzleSolved = true;
    gridEl.classList.add("solved");
    setTimeout(() => gridEl.classList.remove("solved"), 900);
    finishPuzzle();
  }
}

// Reveals one letter of the word in play. Deliberately one *letter*, not
// the whole word: it unsticks a player without handing them the answer,
// and it keeps the cost of a hint proportionate to the help given.
function useHint() {
  if (!puzzle || puzzleSolved) return;

  let word = activeWordId ? wordById[activeWordId] : null;
  if (!word || lockedWords.has(word.id)) {
    word = puzzle.words.find((w) => !lockedWords.has(w.id));
  }
  if (!word) return;

  const keys = word.cells.map(([r, c]) => key(r, c));
  // First cell that isn't already correct - so a hint never burns itself
  // on a letter the player had right, and repeated hints walk the word.
  const idx = keys.findIndex((k, i) => !lockedCells.has(k) && inputEls[k].value !== word.answer[i]);
  if (idx === -1) return;

  const k = keys[idx];
  inputEls[k].value = word.answer[idx];
  cellEls[k].classList.add("hinted");
  hintsUsed++;
  hintedWords.add(word.id);

  selectWord(word.id, false);
  checkWordCompletion();
  updateStats();
  if (!puzzleSolved) setStatus(`Відкрито літеру. Використано підказок: ${hintsUsed}.`);
}

function finishPuzzle() {
  stopTimer();
  const wordCount = puzzle.words.length;
  // A word counts as unaided only if no hint touched it. Crossing letters
  // from a hinted word still help neighbours, but charging every crossing
  // word for one hint would make a single hint cascade into a wrecked
  // score - the player asked for help with one word, not five.
  const solvedUnaided = puzzle.words.filter((w) => lockedWords.has(w.id) && !hintedWords.has(w.id)).length;
  const secs = elapsedSeconds();

  const result = scoreSolve({
    wordCount,
    solvedUnaided,
    hintsUsed,
    elapsedSeconds: secs,
    difficulty: currentDifficulty,
    completed: true,
  });

  showResults(result, secs);
  setStatus("✓ Все правильно!");
}

function showResults(result, secs) {
  document.getElementById("resultsStars").textContent = "★".repeat(result.stars) + "☆".repeat(3 - result.stars);
  document.getElementById("resultsPerfect").hidden = !result.perfect;
  document.getElementById("resultsPoints").textContent = result.points.toLocaleString("uk-UA");
  document.getElementById("resultsMeta").textContent =
    `Час ${formatTime(secs)} · ціль ${formatTime(result.parSeconds)} · підказок ${hintsUsed}`;
  resultsEl.hidden = false;
}

function renderPuzzle(p) {
  puzzle = p;
  cellEls = {};
  inputEls = {};
  cellWordsMap = {};
  wordById = {};
  activeWordId = null;
  focusedKey = null;
  lockedWords = new Set();
  lockedCells = new Set();
  puzzleSolved = false;
  hintsUsed = 0;
  hintedWords = new Set();
  resetTimer();
  resultsEl.hidden = true;
  statusEl.textContent = "";

  p.words.forEach((w) => {
    wordById[w.id] = w;
    w.cells.forEach(([r, c]) => {
      const k = key(r, c);
      if (!cellWordsMap[k]) cellWordsMap[k] = [];
      cellWordsMap[k].push(w.id);
    });
  });
  Object.keys(cellWordsMap).forEach((k) => {
    cellWordsMap[k].sort((a, b) => (wordById[a].dir === "down" ? -1 : 1) - (wordById[b].dir === "down" ? -1 : 1));
  });

  gridEl.innerHTML = "";
  // Columns and rows both get the exact same fixed size, so every cell is
  // a perfect square no matter how much text a clue cell holds - content
  // that doesn't fit scales down or clips (see .clue-text in style.css)
  // rather than stretching the cell.
  const cellSize = cellSizePx(p.rows, p.cols);
  gridEl.style.gridTemplateColumns = `repeat(${p.cols}, ${cellSize}px)`;
  gridEl.style.gridAutoRows = `${cellSize}px`;

  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const k = key(r, c);
      const div = document.createElement("div");

      if (p.isClue[r][c]) {
        const entries = p.clueCells.get(r + "," + c);
        if (!entries) {
          // Occasionally a clue cell doesn't end up serving any word (see
          // grid-skeleton.js) - render it as a small deliberate mark, not
          // a solid block, so it never reads as a forbidden black/blocked
          // square.
          div.className = "cell deco-empty";
          const dot = document.createElement("span");
          dot.className = "deco-dot";
          dot.textContent = "•";
          div.appendChild(dot);
        } else {
          div.className = "cell clue" + (entries.length > 1 ? " dual" : "");
          entries.forEach((entry) => {
            const block = document.createElement("div");
            block.className = "clue-block";
            const text = document.createElement("span");
            text.className = "clue-text";
            text.textContent = entry.text;
            block.appendChild(text);
            block.addEventListener("click", () => selectWord(entry.wordId, true));
            div.appendChild(block);
            // The arrow sits on the cell's edge facing the word's first
            // letter (possibly bent - see ARROWS in grid-skeleton.js),
            // overlapping into the neighbor cell like in print scanwords.
            const arrow = document.createElement("span");
            arrow.className =
              `arrow arrow-${entry.arrow.edge} arrow-${entry.dir}` + (entry.arrow.flip ? " arrow-flip" : "");
            arrow.textContent = entry.arrow.glyph;
            div.appendChild(arrow);
          });
        }
      } else {
        div.className = "cell letter";
        const input = document.createElement("input");
        input.maxLength = 1;
        input.autocomplete = "off";
        input.inputMode = "text";
        inputEls[k] = input;
        div.appendChild(input);
        div.addEventListener("click", () => handleCellClick(k));
        input.addEventListener("keydown", (e) => handleKeydown(e, k));
        input.addEventListener("input", (e) => handleInput(e, k));
      }

      cellEls[k] = div;
      gridEl.appendChild(div);
    }
  }

  fitClueText();
  if (p.words.length) selectWord(p.words[0].id, true);

  statsbarEl.hidden = false;
  parValueEl.textContent = formatTime(parTimeSeconds(p.words.length));
  updateStats();
  startTimer();
}

// Shrinks each clue's font until the whole text fits its cell, so a long
// clue is never cut off - and never widens the cell to make room. Runs
// once per render (and on resize, since the fit depends on cell size).
function fitClueText() {
  const cellSize = puzzle ? cellSizePx(puzzle.rows, puzzle.cols) : 60;
  // Start from a size proportional to the cell, so small cells don't
  // begin far too large and burn iterations getting back down.
  const maxPx = Math.max(6, Math.min(11, Math.round(cellSize * 0.17)));
  const minPx = 4;
  gridEl.querySelectorAll(".clue-block").forEach((block) => {
    const text = block.querySelector(".clue-text");
    if (!text) return;
    // Measure the text element's own box: it is the one that clips
    // (overflow:hidden + max-height), so scrollHeight > clientHeight is
    // exactly "some of this clue is cut off". Comparing against the
    // parent block instead misses the vertical-centering overhang.
    const clipped = () =>
      text.scrollHeight > text.clientHeight + 0.5 ||
      text.scrollWidth > text.clientWidth + 0.5 ||
      text.scrollHeight > block.clientHeight + 0.5;

    const shrinkToFit = () => {
      let size = maxPx;
      text.style.fontSize = size + "px";
      while (size > minPx && clipped()) {
        size -= 0.5;
        text.style.fontSize = size + "px";
      }
      return !clipped();
    };

    // Prefer wrapping at spaces: try the whole range with words kept
    // whole first, and only allow mid-word breaks if even the smallest
    // size can't fit that way. Splitting "фруктовими" across lines is
    // much harder to read than one step smaller type.
    text.style.overflowWrap = "normal";
    if (!shrinkToFit()) {
      text.style.overflowWrap = "break-word";
      shrinkToFit();
    }
  });
}

// Resizes cells and refits clue text in place. Deliberately does NOT
// rebuild the grid: a rebuild would wipe entered letters, drop solved
// words and reset the selection.
function relayoutGrid() {
  if (!puzzle) return;
  const cellSize = cellSizePx(puzzle.rows, puzzle.cols);
  gridEl.style.gridTemplateColumns = `repeat(${puzzle.cols}, ${cellSize}px)`;
  gridEl.style.gridAutoRows = `${cellSize}px`;
  fitClueText();
}

let lastLayoutWidth = window.innerWidth;
let resizeTimer = null;
window.addEventListener("resize", () => {
  if (!puzzle) return;
  // On a phone, focusing a cell opens the on-screen keyboard, which fires
  // resize with a shorter viewport - height changes, width doesn't. Only
  // a real width change affects cell size, so ignore the rest and never
  // disturb the grid while someone is typing into it.
  if (window.innerWidth === lastLayoutWidth) return;
  lastLayoutWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(relayoutGrid, 150);
});

// A single fixed square size for every cell: large enough to read
// comfortably at small grid sizes, shrinking as needed so bigger grids
// still fit the viewport without scrolling sideways.
function cellSizePx(rows, cols) {
  const dim = Math.max(rows, cols);
  const idealByCount = dim <= 8 ? 68 : dim <= 14 ? 48 : 36;
  const viewportCap = Math.floor((Math.min(window.innerWidth, 900) - 32) / cols);
  return Math.max(24, Math.min(idealByCount, viewportCap));
}

function setStatus(text) {
  statusEl.textContent = text;
}

const generateBtn = document.getElementById("generateBtn");

async function runGenerate() {
  const rows = Math.max(5, Math.min(10, parseInt(rowsInput.value, 10) || 6));
  const cols = Math.max(5, Math.min(10, parseInt(colsInput.value, 10) || 6));
  rowsInput.value = rows;
  colsInput.value = cols;

  generateBtn.disabled = true;
  setStatus("Генерую сітку… (для великих сіток це може зайняти кілька секунд)");
  gridEl.innerHTML = "";
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Bigger grids need a lot more retries to land a fillable combination
  // (measured: 6x6 resolves in milliseconds, 10x10 occasionally needs
  // 20-30s of retries) - a flat budget that's generous enough for 10x10
  // would make every failed small-grid attempt wait needlessly long, and
  // one sized for 6x6 would cut 10x10 off before it has a real chance.
  const dim = Math.max(rows, cols);
  const timeBudgetMs = 15000 + Math.max(0, dim - 6) * 4000;
  // A custom-size puzzle still needs a difficulty for the score
  // multiplier. Derive it from the grid the same way the offline
  // generator tiers its output, so a hand-picked 10x10 is worth what a
  // "hard" level of the same size is worth.
  currentDifficulty = dim >= 10 ? "hard" : dim >= 8 ? "medium" : "easy";

  try {
    const result = await generatePuzzle(rows, cols, DICTIONARY, { timeBudgetMs });
    if (!result) {
      setStatus("Не вдалося згенерувати сітку такого розміру. Спробуйте менший розмір.");
      return;
    }
    renderPuzzle(result);
  } finally {
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener("click", runGenerate);

// Levels: puzzles pre-generated offline by tools/generate-levels.mjs and
// committed as static JSON (data/levels/<difficulty>/*.json), listed in
// data/levels/manifest.json. This is the real path for actually playing
// the game - it loads instantly because nothing is solved at request
// time, unlike the "custom size" generator above, which does the full
// backtracking search live and can take many seconds on bigger grids.
// A saved puzzle only stores rows/cols/isClue/words: clueCells is fully
// derived from words, so buildClueCells() (from generator.js) rebuilds it
// here exactly like buildPuzzleModel() does after a live generation.
const levelButtons = {
  easy: document.getElementById("easyBtn"),
  medium: document.getElementById("mediumBtn"),
  hard: document.getElementById("hardBtn"),
};
let manifestCache = null;

function setActionButtonsDisabled(disabled) {
  generateBtn.disabled = disabled;
  Object.values(levelButtons).forEach((btn) => (btn.disabled = disabled));
}

async function loadLevel(difficulty) {
  setActionButtonsDisabled(true);
  setStatus("Завантажую рівень…");
  gridEl.innerHTML = "";

  try {
    if (!manifestCache) {
      const res = await fetch("data/levels/manifest.json");
      if (!res.ok) throw new Error("manifest fetch failed: " + res.status);
      manifestCache = await res.json();
    }
    const files = manifestCache[difficulty] || [];
    if (files.length === 0) {
      setStatus("Рівнів цієї складності ще немає.");
      return;
    }
    const file = files[Math.floor(Math.random() * files.length)];
    const res = await fetch(`data/levels/${difficulty}/${file}`);
    if (!res.ok) throw new Error("level fetch failed: " + res.status);
    const saved = await res.json();

    // Set before renderPuzzle: it starts the clock, and finishPuzzle reads
    // this for the score multiplier.
    currentDifficulty = difficulty;
    renderPuzzle({
      rows: saved.rows,
      cols: saved.cols,
      isClue: saved.isClue,
      words: saved.words,
      clueCells: buildClueCells(saved.words),
    });
  } catch (err) {
    console.error(err);
    setStatus("Не вдалося завантажити рівень.");
  } finally {
    setActionButtonsDisabled(false);
  }
}

Object.entries(levelButtons).forEach(([difficulty, btn]) => {
  btn.addEventListener("click", () => loadLevel(difficulty));
});

document.getElementById("checkBtn").addEventListener("click", () => {
  if (!puzzle) return;
  let filled = 0;
  let total = 0;
  puzzle.words.forEach((w) => {
    w.cells.forEach(([r, c]) => {
      const k = key(r, c);
      total++;
      if (inputEls[k].value) filled++;
    });
  });
  checkWordCompletion();
  const allDone = lockedWords.size === puzzle.words.length;
  if (filled === 0) {
    setStatus("Спробуй вписати кілька літер спочатку.");
  } else if (allDone) {
    setStatus("✓ Все правильно!");
  } else {
    setStatus(`Заповнено ${filled}/${total} клітинок, слів вгадано ${lockedWords.size}/${puzzle.words.length}.`);
  }
});

document.getElementById("resetBtn").addEventListener("click", () => {
  if (!puzzle) return;
  Object.keys(inputEls).forEach((k) => {
    inputEls[k].value = "";
    delete inputEls[k].dataset.letter;
    cellEls[k].classList.remove("locked", "hinted");
  });
  lockedWords = new Set();
  lockedCells = new Set();
  puzzleSolved = false;
  // Restarting the puzzle restarts the attempt: the clock and hint count
  // go back to zero too, otherwise "Спочатку" would be a way to keep a
  // fast time while retrying the parts you got wrong.
  hintsUsed = 0;
  hintedWords = new Set();
  resetTimer();
  resultsEl.hidden = true;
  clearHighlights();
  activeWordId = null;
  focusedKey = null;
  setStatus("");
  if (puzzle.words.length) selectWord(puzzle.words[0].id, true);
  updateStats();
  startTimer();
});

document.getElementById("hintBtn").addEventListener("click", useHint);

runGenerate();
