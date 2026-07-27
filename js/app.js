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

const gridEl = document.getElementById("grid");
const statusEl = document.getElementById("status");
const rowsInput = document.getElementById("rowsInput");
const colsInput = document.getElementById("colsInput");

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
        cellEls[kk].classList.add("locked");
        cellEls[kk].classList.remove("highlight", "focused");
      });
    }
  });
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
  gridEl.style.gridTemplateColumns = `repeat(${p.cols}, minmax(${cellMinSize(p.cols)}px, ${cellMaxSize(p.cols)}px))`;

  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      const k = key(r, c);
      const div = document.createElement("div");

      if (p.isClue[r][c]) {
        const entries = p.clueCells.get(r + "," + c);
        if (!entries) {
          // The generator can occasionally leave a border clue cell
          // unused by any word (see grid-skeleton.js). Render it as a
          // deliberate part of the paper-frame design - a small ornament,
          // never a solid block - so it never reads as a forbidden
          // black/blocked square.
          if (r === 0 && c === 0) {
            div.className = "cell deco";
            const t = document.createElement("div");
            t.className = "deco-title";
            t.textContent = "СКАНВОРД";
            div.appendChild(t);
          } else {
            div.className = "cell deco-empty";
            const dot = document.createElement("span");
            dot.className = "deco-dot";
            dot.textContent = "•";
            div.appendChild(dot);
          }
        } else {
          div.className = "cell clue" + (entries.length > 1 ? " dual" : "");
          entries.forEach((entry) => {
            const block = document.createElement("div");
            block.className = "clue-block";
            const text = document.createElement("span");
            text.className = "clue-text";
            text.textContent = entry.text;
            const arrow = document.createElement("span");
            arrow.className = "arrow";
            arrow.textContent = entry.dir === "down" ? "↓" : "→";
            block.appendChild(text);
            block.appendChild(arrow);
            block.addEventListener("click", () => selectWord(entry.wordId, true));
            div.appendChild(block);
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

  if (p.words.length) selectWord(p.words[0].id, true);
}

function cellMinSize(cols) {
  if (cols <= 8) return 52;
  if (cols <= 14) return 40;
  return 32;
}
function cellMaxSize(cols) {
  if (cols <= 8) return 78;
  if (cols <= 14) return 62;
  return 48;
}

function setStatus(text) {
  statusEl.textContent = text;
}

async function runGenerate() {
  const rows = Math.max(5, Math.min(30, parseInt(rowsInput.value, 10) || 5));
  const cols = Math.max(5, Math.min(30, parseInt(colsInput.value, 10) || 5));
  rowsInput.value = rows;
  colsInput.value = cols;

  setStatus("Генерую сітку…");
  gridEl.innerHTML = "";
  await new Promise((resolve) => setTimeout(resolve, 0));

  const result = generatePuzzle(rows, cols, DICTIONARY);
  if (!result) {
    setStatus("Не вдалося згенерувати сітку такого розміру. Спробуйте менший розмір або дочекайтесь поповнення словника.");
    return;
  }
  renderPuzzle(result);
}

document.getElementById("generateBtn").addEventListener("click", runGenerate);

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
    cellEls[k].classList.remove("locked");
  });
  lockedWords = new Set();
  lockedCells = new Set();
  clearHighlights();
  activeWordId = null;
  focusedKey = null;
  setStatus("");
  if (puzzle.words.length) selectWord(puzzle.words[0].id, true);
});

runGenerate();
