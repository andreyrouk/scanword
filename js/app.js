// Rendering + interaction layer. The interaction mechanic (click a clue to
// select its word, click a crossing cell to toggle between its two words,
// typing advances and skips locked cells, completed words lock) is adapted
// directly from the original interaction prototype, generalized to work
// with any grid size and with clue cells that may serve one or two words.

const key = (r, c) => r + "-" + c;

let puzzle = null;
let cellEls = {};
let letterEls = {}; // key -> the <span> showing the letter in that cell
let letters = {}; // key -> the letter currently entered there ("" if empty)
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
const headerEl = document.querySelector(".header");
const progressEl = document.getElementById("solveProgress");
const progressFillEl = document.getElementById("solveProgressFill");
const progressTrackEl = document.getElementById("solveProgressTrack");
const progressLabelEl = document.getElementById("solveProgressLabel");

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

// Progress counts words confirmed correct, not cells filled: a grid full
// of wrong guesses is not 100% done, and counting them would make the bar
// a measure of typing rather than solving.
function updateSolveProgress() {
  if (!puzzle || !puzzle.words.length) return;
  const done = lockedWords.size;
  const total = puzzle.words.length;
  const pct = Math.round((done / total) * 100);
  progressFillEl.style.width = pct + "%";
  progressLabelEl.textContent = pct + "%";
  progressTrackEl.setAttribute("aria-valuenow", String(pct));
  progressTrackEl.setAttribute("aria-label", `Розгадано ${done} з ${total} слів`);
}

function clearHighlights() {
  Object.values(cellEls).forEach((div) => div.classList.remove("highlight", "focused", "active"));
}

// 3 літери / 5 літер - Ukrainian needs the count agreement, and "3 літер"
// reads as broken to a native speaker.
function letterCountLabel(n) {
  const ones = n % 10;
  const teens = n % 100;
  if (ones === 1 && teens !== 11) return n + " літера";
  if (ones >= 2 && ones <= 4 && (teens < 12 || teens > 14)) return n + " літери";
  return n + " літер";
}

// The bar stays in the layout for the whole solve, even with no word
// selected. Removing it collapsed ~70px directly above the grid, so
// finishing a word yanked the entire puzzle upward under the player's
// finger - which reads as the app glitching, not as progress.
function showClueBar(w, { solved = false } = {}) {
  const bar = document.getElementById("cluebar");
  const dirEl = document.getElementById("cluebarDir");
  const textEl = document.getElementById("cluebarText");
  const lenEl = document.getElementById("cluebarLen");
  bar.hidden = false;
  bar.classList.toggle("cluebar-idle", !w);
  bar.classList.toggle("cluebar-done", !!w && solved);

  if (!w) {
    dirEl.textContent = "";
    textEl.textContent = "Оберіть наступне слово";
    lenEl.textContent = "";
    return;
  }

  // A solved word keeps its own clue in the bar rather than the bar
  // emptying out. Two reasons: the player gets to see what they just got,
  // and the text is unchanged so the bar cannot change height - which is
  // what matters, because it sits directly above the grid and any height
  // change there shifts the whole puzzle mid-solve.
  dirEl.textContent = solved ? "✓" : w.dir === "down" ? "↓" : "→";
  textEl.textContent = w.clue;
  lenEl.textContent = solved ? w.answer : letterCountLabel(w.answer.length);
}

function selectWord(wordId, focusFirst) {
  activeWordId = wordId;
  clearHighlights();
  const w = wordById[wordId];
  w.cells.forEach(([r, c]) => cellEls[key(r, c)].classList.add("highlight"));
  const clueKey = key(w.clueCell[0], w.clueCell[1]);
  if (cellEls[clueKey]) cellEls[clueKey].classList.add("active");
  showClueBar(w);
  if (focusFirst) {
    const firstEditable = w.cells.map(([r, c]) => key(r, c)).find((k) => !lockedCells.has(k));
    if (firstEditable) focusCell(firstEditable);
  } else {
    // Selecting a word without focusing into it (tapping its clue cell on
    // a crossing) should still bring the word on screen.
    keepCellInView(key(w.cells[0][0], w.cells[0][1]));
  }
}

function focusCell(k) {
  if (focusedKey && cellEls[focusedKey]) cellEls[focusedKey].classList.remove("focused");
  focusedKey = k;
  cellEls[k].classList.add("focused");
  // Typing advances cell by cell, and on a phone the grid is wider than
  // the screen - without this the cursor walks off the edge and the
  // player has to swipe after every few letters.
  keepCellInView(k);
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

function prevEditableInWord(wordId, fromKey) {
  const w = wordById[wordId];
  const keys = w.cells.map(([r, c]) => key(r, c));
  const idx = keys.indexOf(fromKey);
  for (let i = idx - 1; i >= 0; i--) {
    if (!lockedCells.has(keys[i])) return keys[i];
  }
  return null;
}

// --- entering letters --------------------------------------------------
// Cells hold plain text, not <input>s, and all input arrives here: from
// the in-app keyboard (js: KEYBOARD_ROWS below) and from a physical
// keyboard on desktop. See the "Entering letters" section of the README
// for why there is no <input> in the grid at all.

// The 33 letters of the Ukrainian alphabet, and nothing else. Ё, Ъ, Ы and
// Э are Russian-only and appear in no Ukrainian word, so a keystroke
// producing one is not a letter this game accepts.
const UK_LETTERS = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ";

// A physical key's position, mapped to the Ukrainian letter that sits
// there on a ЙЦУКЕН layout. This is the desktop half of the same problem
// the in-app keyboard solves on phones: somebody whose laptop is set to
// English can touch-type Ukrainian without installing a layout or
// switching one. Position-based, so it matches what is printed on a
// Ukrainian keyboard rather than transliterating.
const QWERTY_TO_UK = {
  q: "Й", w: "Ц", e: "У", r: "К", t: "Е", y: "Н", u: "Г", i: "Ш", o: "Щ", p: "З", "[": "Х", "]": "Ї",
  a: "Ф", s: "І", d: "В", f: "А", g: "П", h: "Р", j: "О", k: "Л", l: "Д", ";": "Ж", "'": "Є", "\\": "Ґ",
  z: "Я", x: "Ч", c: "С", v: "М", b: "И", n: "Т", m: "Ь", ",": "Б", ".": "Ю",
};

// Turns a raw key value into a Ukrainian letter, or "" if it isn't one.
function normalizeTypedKey(raw) {
  if (typeof raw !== "string" || raw.length !== 1) return "";
  const upper = raw.toUpperCase();
  if (UK_LETTERS.includes(upper)) return upper;
  return QWERTY_TO_UK[raw.toLowerCase()] || "";
}

function getLetter(k) {
  return letters[k] || "";
}

function setLetter(k, ch) {
  letters[k] = ch;
  if (letterEls[k]) letterEls[k].textContent = ch;
}

function typeLetter(ch) {
  if (!puzzle || puzzleSolved) return;
  if (!focusedKey || lockedCells.has(focusedKey)) return;
  const letter = normalizeTypedKey(ch);
  if (!letter) return;

  const k = focusedKey;
  setLetter(k, letter);
  checkWordCompletion();
  // checkWordCompletion clears the selection if that entry completed the
  // word, so only advance while one is still in play.
  if (activeWordId) {
    const next = nextEditableInWord(activeWordId, k);
    if (next) focusCell(next);
  }
}

// Backspace clears the current cell if it has a letter, otherwise steps
// back and clears that one - the behaviour a text field would give, which
// is what fingers expect even when there is no text field.
function backspaceLetter() {
  if (!puzzle || puzzleSolved || !focusedKey) return;
  if (!lockedCells.has(focusedKey) && getLetter(focusedKey)) {
    setLetter(focusedKey, "");
    return;
  }
  if (!activeWordId) return;
  const prev = prevEditableInWord(activeWordId, focusedKey);
  if (prev) {
    focusCell(prev);
    setLetter(prev, "");
  }
}

// Step within the word in play, skipping cells already locked in.
function moveFocus(delta) {
  if (!activeWordId || !focusedKey) return;
  const next = delta < 0 ? prevEditableInWord(activeWordId, focusedKey) : nextEditableInWord(activeWordId, focusedKey);
  if (next) focusCell(next);
}

// A physical keyboard still works, and still matters: this is a website
// before it is a phone app, and someone on a laptop with a Ukrainian
// layout should just type. Ignored while a real form field has focus, so
// the custom-grid row/column boxes keep working.
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
  if (!puzzle || playScreen.hidden) return;

  if (e.key === "Backspace") {
    backspaceLetter();
    e.preventDefault();
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    moveFocus(-1);
    e.preventDefault();
  } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    moveFocus(1);
    e.preventDefault();
  } else if (normalizeTypedKey(e.key)) {
    typeLetter(e.key);
    e.preventDefault();
  }
});

function checkWordCompletion() {
  puzzle.words.forEach((w) => {
    if (lockedWords.has(w.id)) return;
    const keys = w.cells.map(([r, c]) => key(r, c));
    const current = keys.map((kk) => getLetter(kk)).join("");
    if (current.length === w.answer.length && current === w.answer) {
      lockedWords.add(w.id);
      keys.forEach((kk, i) => {
        lockedCells.add(kk);
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
        showClueBar(w, { solved: true });
      }
    }
  });

  updateSolveProgress();

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
  // Start at the cell the player is actually sitting on: if they asked for
  // help, the letter they're stuck on is the one under the cursor, not the
  // start of the word. Scanning wraps around so a hint still lands
  // somewhere useful when the focused cell is already correct (or when
  // nothing is focused at all), and repeated hints walk forward from
  // there rather than re-revealing the same spot.
  const focusedIdx = keys.indexOf(focusedKey);
  const start = focusedIdx === -1 ? 0 : focusedIdx;
  let idx = -1;
  for (let n = 0; n < keys.length; n++) {
    const i = (start + n) % keys.length;
    if (!lockedCells.has(keys[i]) && getLetter(keys[i]) !== word.answer[i]) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return;

  const k = keys[idx];
  setLetter(k, word.answer[idx]);
  cellEls[k].classList.add("hinted");
  hintsUsed++;
  hintedWords.add(word.id);

  selectWord(word.id, false);
  checkWordCompletion();
  updateStats();
  // Advance the way typing does, so the player carries on from where the
  // hint left them instead of having to click back into the grid.
  if (!lockedWords.has(word.id)) {
    const next = nextEditableInWord(word.id, k);
    if (next) focusCell(next);
  }
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

  // Three destinations: a campaign level records ladder progress, the
  // daily records against its date (and streak), and quick-play/custom
  // grids record nothing because there's nothing to attach them to.
  let record = null;
  let streak = null;
  if (currentDailyKey !== null) {
    const res = recordDailyResult(currentDailyKey, {
      stars: result.stars,
      points: result.points,
      timeSec: Math.round(secs),
      hints: hintsUsed,
      completed: true,
    });
    record = res;
    streak = res.streak;
  } else if (currentLevelN !== null) {
    record = recordLevelResult(currentLevelN, {
      stars: result.stars,
      points: result.points,
      timeSec: Math.round(secs),
      hints: hintsUsed,
      completed: true,
    });
    renderLadder();
    updateProgressSummary();
  }

  showResults(result, secs, record, streak);
  setStatus("✓ Все правильно!");
}

function showResults(result, secs, record, streak = null) {
  document.getElementById("resultsStars").textContent = "★".repeat(result.stars) + "☆".repeat(3 - result.stars);
  document.getElementById("resultsPerfect").hidden = !result.perfect;
  document.getElementById("resultsPoints").textContent = result.points.toLocaleString("uk-UA");
  document.getElementById("resultsMeta").textContent =
    `Час ${formatTime(secs)} · ціль ${formatTime(result.parSeconds)} · підказок ${hintsUsed}`;

  const bestEl = document.getElementById("resultsBest");
  const bits = [];
  if (record && record.improved) bits.push("Новий рекорд!");
  else if (record) bits.push(`Ваш рекорд: ${record.merged.points.toLocaleString("uk-UA")} очок`);
  if (streak) bits.push(`Серія: ${streak} ${streak === 1 ? "день" : "дн."}`);
  bestEl.textContent = bits.join(" · ");
  bestEl.hidden = bits.length === 0;

  // "Next level" is campaign-only: the daily has no next puzzle to go to.
  const nextBtn = document.getElementById("nextLevelBtn");
  nextBtn.hidden = !(currentDailyKey === null && currentLevelN !== null && ladder && currentLevelN < ladder.levels.length);
  document.getElementById("toMenuBtn").textContent = currentDailyKey !== null ? "До меню" : "До рівнів";

  resultsEl.hidden = false;
}

function renderPuzzle(p) {
  puzzle = p;
  cellEls = {};
  letterEls = {};
  letters = {};
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
  showClueBar(null);

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
        // A plain <span>, not an <input>. Nothing in the grid is a form
        // field any more, so the OS keyboard never opens over the puzzle,
        // there is no caret for iOS to chase or magnify, and the player
        // is not made to switch layouts to type Ukrainian. Letters come
        // from the in-app keyboard and from physical keys - see
        // typeLetter().
        div.className = "cell letter";
        const span = document.createElement("span");
        span.className = "cell-letter-text";
        span.textContent = letters[k] || "";
        letterEls[k] = span;
        div.appendChild(span);
        div.addEventListener("click", () => handleCellClick(k));
      }

      cellEls[k] = div;
      gridEl.appendChild(div);
    }
  }

  fitClueText();
  if (p.words.length) selectWord(p.words[0].id, true);

  statsbarEl.hidden = false;
  progressEl.hidden = false;
  updateSolveProgress();
  updateKeyboardVisibility();
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

// Cells never shrink below this, even if that makes the grid wider than
// the screen - .grid-wrap scrolls instead. Two reasons, and they happen
// to agree on the same number:
//
//   Readable. The median clue is 33 characters. Fitting 33 characters
//   inside a square of side S caps the font at roughly S/4.6, so the 32px
//   cells an 11-column grid used to get on an iPhone allowed about 7px
//   type - which is why the grid was unreadable without pinch-zooming,
//   and pinch-zooming is what dragged badly. 44px buys ~9.6px instead.
//
//   Tappable. 44px is also the minimum touch target in Apple's HIG, so
//   the old 32px (floor: 24px) cells were below the size at which a
//   fingertip reliably hits the cell it aimed at.
const MIN_CELL_PX = 44;

// How far below MIN_CELL_PX a grid may shrink to avoid scrolling at all.
// A grid that misses fitting by three pixels should give up those three
// pixels, not become a scrolling surface for nothing.
const FIT_TOLERANCE_PX = 3;

// A single fixed square size for every cell: large enough to read
// comfortably at small grid sizes, shrinking to fit the viewport for
// bigger ones - but never past MIN_CELL_PX, beyond which .grid-wrap
// scrolls sideways instead.
function cellSizePx(rows, cols) {
  const dim = Math.max(rows, cols);
  const idealByCount = dim <= 8 ? 68 : dim <= 14 ? 48 : 36;
  // The size that fits exactly, counting the 1px gap between each pair of
  // cells and the grid's own 1px border. Ignoring those overflows the
  // viewport by a handful of pixels and scrolls for no reason.
  const available = Math.min(window.innerWidth, 900) - 32;
  const fitted = Math.floor((available - cols - 1) / cols);

  if (fitted >= MIN_CELL_PX - FIT_TOLERANCE_PX) return Math.min(idealByCount, fitted);
  return Math.max(MIN_CELL_PX, Math.min(idealByCount, fitted));
}

// Scrolls the minimum needed to bring a cell into view, on whichever axis
// needs it. Deliberately not element.scrollIntoView(): that centres the
// element and walks every scrollable ancestor, which yanks the layout
// around mid-word. This moves each axis by exactly the shortfall, and only
// when there is one, so a cell already on screen never causes a jump.
function keepCellInView(k) {
  const cell = cellEls[k];
  const wrap = gridEl.parentElement;
  if (!cell || !wrap) return;
  const margin = 8; // show a sliver of the neighbouring cell for context

  // Sideways: inside the grid's own scroller, since a big grid is wider
  // than the screen.
  const cellBox = cell.getBoundingClientRect();
  const wrapBox = wrap.getBoundingClientRect();
  if (cellBox.left < wrapBox.left + margin) {
    wrap.scrollLeft -= wrapBox.left + margin - cellBox.left;
  } else if (cellBox.right > wrapBox.right - margin) {
    wrap.scrollLeft += cellBox.right - wrapBox.right + margin;
  }

  // Vertically: on the page - and the keyboard is fixed over the bottom of
  // it, so the usable area ends where the keys begin. Without this the
  // cursor can advance into a row hidden behind the keyboard and the
  // player ends up typing blind. Re-measured, because the horizontal
  // scroll above may have moved the cell.
  const after = cell.getBoundingClientRect();
  const keyboardHeight = keyboardEl && !keyboardEl.hidden ? keyboardEl.offsetHeight : 0;
  const usableBottom = window.innerHeight - keyboardHeight;
  if (after.bottom > usableBottom - margin) {
    window.scrollBy(0, after.bottom - usableBottom + margin);
  } else if (after.top < margin) {
    window.scrollBy(0, after.top - margin);
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

const generateBtn = document.getElementById("generateBtn");

// The dictionary is ~1MB - more than half the app - and only the live
// generator below needs it: the 100 ladder levels and the daily ship with
// their words already baked in. Loading it on demand keeps the first
// launch (and the offline install) small for the majority of players who
// never open "своя сітка", at the cost of one wait the first time they do.
let dictionaryPromise = null;

function loadDictionary() {
  if (typeof DICTIONARY !== "undefined") return Promise.resolve(DICTIONARY);
  if (!dictionaryPromise) {
    dictionaryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "data/dictionary.js";
      script.onload = () => resolve(DICTIONARY);
      script.onerror = () => {
        // Clear the cached promise so a failure (offline, blocked) can be
        // retried by pressing the button again rather than being sticky
        // for the rest of the session.
        dictionaryPromise = null;
        reject(new Error("dictionary load failed"));
      };
      document.head.appendChild(script);
    });
  }
  return dictionaryPromise;
}

async function runGenerate() {
  const rows = Math.max(5, Math.min(10, parseInt(rowsInput.value, 10) || 6));
  const cols = Math.max(5, Math.min(10, parseInt(colsInput.value, 10) || 6));
  rowsInput.value = rows;
  colsInput.value = cols;

  generateBtn.disabled = true;
  // A hand-rolled grid isn't a ladder level or the daily either.
  currentLevelN = null;
  currentDailyKey = null;
  showPlay("Своя сітка");
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
    let dictionary;
    try {
      dictionary = await loadDictionary();
    } catch (err) {
      console.error(err);
      setStatus("Не вдалося завантажити словник. Перевірте з'єднання — рівні працюють і без нього.");
      return;
    }

    const result = await generatePuzzle(rows, cols, dictionary, { timeBudgetMs });
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
    // Quick play has no ladder position, so nothing is recorded for it.
    currentLevelN = null;
    currentDailyKey = null;
    showPlay("Швидка гра");
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
      if (getLetter(k)) filled++;
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
  Object.keys(letterEls).forEach((k) => {
    setLetter(k, "");
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
  updateSolveProgress();
  setStatus("");
  if (puzzle.words.length) selectWord(puzzle.words[0].id, true);
  updateStats();
  startTimer();
});

document.getElementById("hintBtn").addEventListener("click", useHint);

// --- the in-app keyboard ----------------------------------------------
// Standard Ukrainian ЙЦУКЕН, so the muscle memory of anyone who types
// Ukrainian carries straight over. Note what it does not have: Ё, Ъ, Ы
// and Э are Russian letters and appear in no Ukrainian word, and every
// answer in the game is checked against this alphabet. Ґ is here even
// though no answer in the current 100 levels uses it - it is a real
// Ukrainian letter and future content may.
//
// Two reasons this exists rather than the system keyboard. A player whose
// phone is set to English would otherwise have to switch layouts to play
// at all, and the OS keyboard opens and closes as focus moves, resizing
// the viewport under the grid every time. It also means no cell needs to
// be an <input>, which is what removed the iOS magnifier, the caret
// chasing and the layout thrash in one go.
const KEYBOARD_ROWS = [
  ["Й", "Ц", "У", "К", "Е", "Н", "Г", "Ш", "Щ", "З", "Х", "Ї"],
  ["Ф", "І", "В", "А", "П", "Р", "О", "Л", "Д", "Ж", "Є", "Ґ"],
  [
    { action: "left", label: "◀", aria: "Попередня клітинка" },
    "Я",
    "Ч",
    "С",
    "М",
    "И",
    "Т",
    "Ь",
    "Б",
    "Ю",
    { action: "back", label: "⌫", aria: "Стерти" },
    { action: "right", label: "▶", aria: "Наступна клітинка" },
  ],
];

const keyboardEl = document.getElementById("keyboard");

function buildKeyboard() {
  const frag = document.createDocumentFragment();
  KEYBOARD_ROWS.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "kb-row";
    row.forEach((entry) => {
      const spec = typeof entry === "string" ? { letter: entry } : entry;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kb-key" + (spec.action ? " kb-key-action" : "");
      btn.textContent = spec.letter || spec.label;
      btn.setAttribute("aria-label", spec.aria || spec.letter);
      if (spec.letter) btn.dataset.letter = spec.letter;
      // pointerdown, not click: it fires on finger-down so the key
      // responds immediately, and preventDefault stops the browser
      // treating the press as a focus change or a double-tap.
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (spec.letter) typeLetter(spec.letter);
        else if (spec.action === "back") backspaceLetter();
        else if (spec.action === "left") moveFocus(-1);
        else if (spec.action === "right") moveFocus(1);
      });
      rowEl.appendChild(btn);
    });
    frag.appendChild(rowEl);
  });
  keyboardEl.appendChild(frag);
}

buildKeyboard();

// The keyboard is shown while a puzzle is open and hidden everywhere
// else, and can be folded away for a full view of a large grid.
let keyboardHidden = false;

function updateKeyboardVisibility() {
  const playing = !playScreen.hidden && !!puzzle;
  keyboardEl.hidden = !playing || keyboardHidden;
  const toggle = document.getElementById("keyboardToggle");
  toggle.hidden = !playing;
  toggle.setAttribute("aria-pressed", String(!keyboardHidden));
  toggle.textContent = keyboardHidden ? "⌨ Показати" : "⌨ Сховати";
  // The bar is fixed to the bottom of the viewport, so the play screen has
  // to reserve exactly its height or the controls sit behind it. Measured
  // rather than hardcoded: the height depends on the safe-area inset,
  // which varies by device.
  const height = keyboardEl.hidden ? 0 : keyboardEl.offsetHeight;
  document.documentElement.style.setProperty("--kb-height", height + "px");
}

document.getElementById("keyboardToggle").addEventListener("click", () => {
  keyboardHidden = !keyboardHidden;
  updateKeyboardVisibility();
});

// --- campaign ladder ---------------------------------------------------
const homeScreen = document.getElementById("homeScreen");
const menuScreen = document.getElementById("menuScreen");
const playScreen = document.getElementById("playScreen");
const ladderEl = document.getElementById("ladder");
let ladder = null;
let currentLevelN = null; // null = quick play / custom / daily: no campaign record
let currentDailyKey = null; // set only while the daily puzzle is in play

const SCREENS = { home: homeScreen, levels: menuScreen, play: playScreen };

function showScreen(name) {
  // Leaving a puzzle mid-solve must stop the clock, or an abandoned run
  // keeps accruing time and poisons the next result recorded for it.
  if (name !== "play") stopTimer();
  Object.entries(SCREENS).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  // The masthead is orientation for someone arriving at the site; during a
  // solve it is 150px of the screen spent on something the player already
  // knows, pushing the grid below the fold. The play screen has its own
  // header row with the back button and level name.
  headerEl.hidden = name === "play";
  updateKeyboardVisibility();
}

function showHome() {
  showScreen("home");
  updateHomeSummary();
}

function showMenu() {
  showScreen("levels");
  renderLadder();
  updateProgressSummary();
}

function showPlay(title, { daily = false } = {}) {
  showScreen("play");
  document.getElementById("playTitle").textContent = title || "";
  const badge = document.getElementById("dailyBadge");
  badge.hidden = !daily;
  badge.textContent = daily ? "СКАНВОРД ДНЯ" : "";
}

function updateHomeSummary() {
  if (!ladder) return;
  const total = ladder.levels.length;
  document.getElementById("homePlaySub").textContent = `${completedCount()} / ${total} рівнів · ★ ${totalStars()}`;

  const key = dailyDateKey();
  const done = getDailyResult(key);
  const streak = getDailyStreak();
  const parts = [];
  if (done && done.completed) parts.push(`сьогодні пройдено ★ ${done.stars}`);
  else parts.push("сьогодні ще не пройдено");
  if (streak > 0) parts.push(`серія ${streak}`);
  document.getElementById("homeDailySub").textContent = parts.join(" · ");
}

function updateProgressSummary() {
  if (!ladder) return;
  const total = ladder.levels.length;
  document.getElementById("totalStars").textContent = String(totalStars());
  document.getElementById("maxStars").textContent = String(total * 3);
  document.getElementById("progressSub").textContent = `пройдено ${completedCount()} з ${total}`;
}

function renderLadder() {
  if (!ladder) return;
  const frag = document.createDocumentFragment();

  ladder.levels.forEach((lvl) => {
    const prog = getLevelProgress(lvl.n);
    const unlocked = isUnlocked(lvl.n);

    const btn = document.createElement("button");
    btn.className = "level-tile";
    if (prog && prog.completed) btn.classList.add("done");
    // Highlight the level the player is actually up to, so a long ladder
    // has an obvious entry point instead of making them hunt for it.
    if (unlocked && !(prog && prog.completed)) btn.classList.add("current");
    btn.disabled = !unlocked;
    btn.title = unlocked ? `${lvl.rows}x${lvl.cols}, ${lvl.words} слів` : "Пройдіть попередній рівень";

    // Locked tiles still show their number rather than a padlock: a wall
    // of emoji locks reads loud against the rest of the design, and seeing
    // the numbers ahead is more useful than being told, 70 times, that
    // they're locked. The dimmed disabled state already says that.
    const n = document.createElement("span");
    n.className = "level-tile-n";
    n.textContent = String(lvl.n);
    btn.appendChild(n);

    const stars = document.createElement("span");
    stars.className = "level-tile-stars";
    stars.textContent = prog && prog.stars ? "★".repeat(prog.stars) : "";
    btn.appendChild(stars);

    btn.addEventListener("click", () => loadLadderLevel(lvl.n));
    frag.appendChild(btn);
  });

  ladderEl.innerHTML = "";
  ladderEl.appendChild(frag);
}

async function loadLadderLevel(n) {
  if (!ladder) return;
  const lvl = ladder.levels.find((l) => l.n === n);
  if (!lvl || !isUnlocked(n)) return;

  showPlay(`Рівень ${n} · ${lvl.rows}×${lvl.cols}`);
  setStatus("Завантажую рівень…");
  gridEl.innerHTML = "";

  try {
    const res = await fetch(`data/levels/${lvl.file}`);
    if (!res.ok) throw new Error("level fetch failed: " + res.status);
    const saved = await res.json();

    currentLevelN = n;
    currentDailyKey = null;
    currentDifficulty = lvl.tier;
    renderPuzzle({
      rows: saved.rows,
      cols: saved.cols,
      isClue: saved.isClue,
      words: saved.words,
      clueCells: buildClueCells(saved.words),
    });
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus("Не вдалося завантажити рівень.");
  }
}

async function loadDaily() {
  if (!ladder) return;
  const dateKey = dailyDateKey();
  const lvl = pickDailyLevel(ladder.levels, dateKey);
  if (!lvl) {
    setStatus("Сканворд дня недоступний.");
    return;
  }

  showPlay(`${lvl.rows}×${lvl.cols}`, { daily: true });
  setStatus("Завантажую…");
  gridEl.innerHTML = "";

  try {
    const res = await fetch(`data/levels/${lvl.file}`);
    if (!res.ok) throw new Error("daily fetch failed: " + res.status);
    const saved = await res.json();

    // The daily is not a campaign level: it must not write to ladder
    // progress or unlock anything, so currentLevelN stays null and the
    // date key routes the result to daily storage instead.
    currentLevelN = null;
    currentDailyKey = dateKey;
    currentDifficulty = "daily";
    renderPuzzle({
      rows: saved.rows,
      cols: saved.cols,
      isClue: saved.isClue,
      words: saved.words,
      clueCells: buildClueCells(saved.words),
    });

    const prev = getDailyResult(dateKey);
    setStatus(prev && prev.completed ? `Сьогодні вже пройдено (★ ${prev.stars}). Можна перерозв'язати.` : "");
  } catch (err) {
    console.error(err);
    setStatus("Не вдалося завантажити сканворд дня.");
  }
}

// The back button returns wherever the player came from, so the daily
// doesn't dump them into the level list they never opened.
document.getElementById("backBtn").addEventListener("click", () => {
  if (currentDailyKey !== null) showHome();
  else showMenu();
});
document.getElementById("toMenuBtn").addEventListener("click", () => {
  if (currentDailyKey !== null) showHome();
  else showMenu();
});
document.getElementById("levelsBackBtn").addEventListener("click", showHome);
document.getElementById("playBtn").addEventListener("click", showMenu);
document.getElementById("dailyBtn").addEventListener("click", loadDaily);
document.getElementById("nextLevelBtn").addEventListener("click", () => {
  if (currentLevelN !== null) loadLadderLevel(currentLevelN + 1);
});

async function initLadder() {
  try {
    const res = await fetch("data/levels/ladder.json");
    if (!res.ok) throw new Error("ladder fetch failed: " + res.status);
    ladder = await res.json();
  } catch (err) {
    console.error(err);
    ladderEl.textContent = "Не вдалося завантажити рівні.";
    return;
  }
  renderLadder();
  updateProgressSummary();
  updateHomeSummary();

  // The installed app's "Сканворд дня" shortcut launches ./?screen=daily.
  // Handled here rather than at startup because it needs the ladder.
  if (new URLSearchParams(location.search).get("screen") === "daily") loadDaily();
}

initLadder();
