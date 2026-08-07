// Mobile grid interaction.  node tools/test-mobile.mjs
//
// Covers the in-app keyboard, the layout rules that make a grid readable
// and swipeable on a phone, and panning.
//
// The load-bearing fact is that no cell is a form field any more. That is
// what keeps the OS keyboard shut and removes every caret the browser
// could chase or magnify, so the tests assert it directly rather than
// asserting properties of an <input> that should not exist.
//
// Only Chromium is available here, so iOS-specific UI (the selection
// magnifier, the system keyboard) still cannot be rendered. What can be
// checked is the structure that made those problems possible, plus every
// bit of the typing behaviour that replaced them.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, devices } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  (async () => {
    const target = (await stat(file)).isDirectory() ? join(file, "index.html") : file;
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] || "application/octet-stream" });
    res.end(body);
  })().catch(() => res.writeHead(404).end("not found"));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

let passed = 0;
const failures = [];
const check = (name, cond, detail = "") => {
  if (cond) passed++;
  else failures.push(`${name}${detail ? " - " + detail : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext({ ...devices["iPhone 13"], isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on("pageerror", (err) => failures.push("page error: " + err.message));

await page.goto(base, { waitUntil: "load" });
await page.waitForFunction(() => document.querySelectorAll("#ladder .level-tile").length === 100, null, { timeout: 20000 });

// Pick the biggest level available, since a small grid on a phone needs no
// zooming and would not exercise the thing being fixed.
const bigN = await page.evaluate(() => ladder.levels.slice().sort((a, b) => b.rows * b.cols - a.rows * a.cols)[0].n);
await page.evaluate((n) => {
  // Unlock everything: this is a rendering/input test, not a progress one.
  ladder.levels.forEach((l) => recordLevelResult(l.n, { stars: 1, points: 1, timeSec: 1, hints: 0, completed: true }));
  loadLadderLevel(n);
}, bigN);
await page.waitForFunction(() => document.querySelectorAll("#grid .cell.letter").length > 0, null, { timeout: 20000 });

const dims = await page.evaluate(() => ({ rows: puzzle.rows, cols: puzzle.cols }));

// --- no form fields in the grid --------------------------------------
// This is the whole reason the OS keyboard stays shut and there is no
// caret to chase or magnify. Asserted structurally, because a single
// stray <input> would quietly bring all of it back.
const structure = await page.evaluate(() => {
  const cell = document.querySelector("#grid .cell.letter");
  const clue = document.querySelector("#grid .cell.clue");
  return {
    inputs: document.querySelectorAll("#grid input, #grid textarea, #grid [contenteditable]").length,
    letterSpans: document.querySelectorAll("#grid .cell.letter .cell-letter-text").length,
    letterCells: document.querySelectorAll("#grid .cell.letter").length,
    cellSelect: getComputedStyle(cell).userSelect || getComputedStyle(cell).webkitUserSelect,
    clueSelect: getComputedStyle(clue).userSelect,
    gridTouch: getComputedStyle(document.getElementById("grid")).touchAction,
  };
});
check("no cell is a form field", structure.inputs === 0, `${structure.inputs} found`);
check("every letter cell renders its letter as text", structure.letterSpans === structure.letterCells);
check("letter cells take no text selection", structure.cellSelect === "none", `got "${structure.cellSelect}"`);
check("letter cells match clue cells, which always panned fine", structure.cellSelect === structure.clueSelect);

// --- the keyboard -----------------------------------------------------
const kb = await page.evaluate(() => {
  const keys = [...document.querySelectorAll("#keyboard .kb-key")];
  return {
    letters: keys.filter((b) => b.dataset.letter).map((b) => b.dataset.letter),
    actions: keys.filter((b) => !b.dataset.letter).map((b) => b.textContent),
    visible: !document.getElementById("keyboard").hidden,
    minHeight: Math.min(...keys.map((b) => Math.round(b.getBoundingClientRect().height))),
    touch: getComputedStyle(document.getElementById("keyboard")).touchAction,
  };
});
const UK = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ";
check("the keyboard is showing during play", kb.visible);
check("it has all 33 Ukrainian letters", kb.letters.length === 33, `${kb.letters.length} keys`);
check(
  "every Ukrainian letter is present exactly once",
  [...UK].every((c) => kb.letters.filter((x) => x === c).length === 1),
  [...UK].filter((c) => !kb.letters.includes(c)).join("") || "ok"
);
check(
  "no Russian-only letters",
  !kb.letters.some((c) => "ЁЪЫЭ".includes(c)),
  kb.letters.filter((c) => "ЁЪЫЭ".includes(c)).join("")
);
check("it has backspace and both cursor keys", kb.actions.length === 3, kb.actions.join(" "));
check("keys are tall enough to hit", kb.minHeight >= 40, `${kb.minHeight}px`);
check("keyboard gestures never scroll or zoom", kb.touch === "manipulation", kb.touch);

// Tapping a key must enter a letter and advance, without any cell ever
// taking DOM focus.
const firstKey = await page.evaluate(() => {
  const w = puzzle.words.find((x) => x.dir === "across") || puzzle.words[0];
  selectWord(w.id, true);
  return { k: focusedKey, wordId: w.id };
});

async function tapKey(label) {
  await page.locator(`#keyboard .kb-key`, { hasText: new RegExp(`^${label}$`) }).first().dispatchEvent("pointerdown");
}

await tapKey("Ж");
const afterKey = await page.evaluate((info) => ({
  letter: getLetter(info.k),
  shown: letterEls[info.k].textContent,
  advanced: focusedKey !== info.k,
  activeIsBody: document.activeElement === document.body || !document.activeElement.closest("#grid"),
}), firstKey);
check("tapping a key writes the letter", afterKey.letter === "Ж");
check("the cell displays it", afterKey.shown === "Ж");
check("focus advances to the next cell", afterKey.advanced);
check("no grid element ever takes DOM focus, so no OS keyboard opens", afterKey.activeIsBody);

// Backspace: clears the current cell, then steps back and clears that one.
await page.evaluate(() => moveFocus(-1));
await tapKey("⌫");
check("backspace clears the current cell", (await page.evaluate((i) => getLetter(i.k), firstKey)) === "");

await page.evaluate((i) => {
  focusCell(i.k);
}, firstKey);
await tapKey("Ж");
await tapKey("З");
const secondKeyCell = await page.evaluate((i) => nextEditableInWord(i.wordId, i.k), firstKey);
await tapKey("⌫");
check("backspace on an empty cell steps back and clears", (await page.evaluate((k) => getLetter(k), secondKeyCell)) === "");

// Cursor keys move within the word.
const moved = await page.evaluate((i) => {
  focusCell(i.k);
  const start = focusedKey;
  moveFocus(1);
  const fwd = focusedKey;
  moveFocus(-1);
  return { start, fwd, back: focusedKey };
}, firstKey);
check("the cursor keys move within the word", moved.fwd !== moved.start && moved.back === moved.start);

// Typing into a filled cell replaces the letter, from any state.
await page.evaluate((i) => {
  focusCell(i.k);
  setLetter(i.k, "Я");
}, firstKey);
await tapKey("Ц");
check("typing over a filled cell replaces it", (await page.evaluate((i) => getLetter(i.k), firstKey)) === "Ц");

// A physical keyboard still works - this is a website too. And an English
// layout types Ukrainian by key position, so nobody has to switch layouts
// on a laptop either.
await page.evaluate((i) => {
  focusCell(i.k);
  setLetter(i.k, "");
}, firstKey);
await page.keyboard.press("KeyF"); // 'f' sits where 'А' is on ЙЦУКЕН
check(
  "an English-layout key types the Ukrainian letter in that position",
  (await page.evaluate((i) => getLetter(i.k), firstKey)) === "А",
  "f -> А"
);
// Cyrillic keys are dispatched directly rather than via keyboard.type():
// Playwright sends non-ASCII through Input.insertText, which never fires
// a keydown, so it cannot exercise the handler under test at all.
const cyrillic = await page.evaluate((i) => {
  const press = (key) => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  focusCell(i.k);
  setLetter(i.k, "");
  press("д");
  const typed = getLetter(i.k);
  focusCell(i.k);
  setLetter(i.k, "");
  press("ы"); // Russian-only, and in no Ukrainian word
  const rejected = getLetter(i.k);
  return { typed, rejected };
}, firstKey);
check("a Ukrainian key types itself", cyrillic.typed === "Д", cyrillic.typed);
check("a Russian-only letter is rejected", cyrillic.rejected === "", cyrillic.rejected);

// The document-level keydown handler must keep its hands off real form
// controls, or the custom-grid row/column boxes become untypeable.
const guarded = await page.evaluate((i) => {
  focusCell(i.k);
  setLetter(i.k, "");
  const probe = document.createElement("input");
  document.body.appendChild(probe);
  probe.focus();
  const focusedProbe = document.activeElement === probe;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true }));
  const leaked = getLetter(i.k);
  probe.remove();
  return { focusedProbe, leaked };
}, firstKey);
check("a focused form field keeps its own keys", guarded.focusedProbe && guarded.leaked === "", `grid got "${guarded.leaked}"`);

// --- solving with the keyboard ----------------------------------------
const typed = await page.evaluate(() => {
  // Every answer through the real entry path, so advance/lock/complete
  // are all exercised rather than the state being assigned.
  for (const w of puzzle.words) {
    selectWord(w.id, false);
    // Per cell, not per keystroke: crossing words leave some cells already
    // locked, so the nth letter of the answer is not the nth letter typed.
    w.cells.forEach(([r, c], i) => {
      const k = r + "-" + c;
      if (lockedCells.has(k)) return;
      focusCell(k);
      typeLetter(w.answer[i]);
    });
  }
  return { solved: puzzleSolved, locked: lockedWords.size, total: puzzle.words.length };
});
check("a full grid solves through the keyboard path", typed.solved && typed.locked === typed.total, JSON.stringify(typed));

// Back to an unsolved grid: everything below needs live, unlocked words.
await page.click("#resetBtn");
await page.waitForFunction(() => lockedWords.size === 0 && !puzzleSolved, null, { timeout: 5000 });

// --- dragging ----------------------------------------------------------
// Chromium already pans on inputs where iOS selects, so a passing drag
// here is not proof the iOS symptom is gone. It is proof the grid still
// scrolls from both kinds of cell, and that a drag leaves no selection
// behind - a selection range is the thing iOS attaches its magnifier to,
// so "no range after dragging" is the closest engine-neutral proxy
// available without a real iPhone.
//
// Real touch events, not Input.synthesizeScrollGesture: that reports
// success and scrolls nothing here, which would have made this a test
// that always passed.
const client = await context.newCDPSession(page);

async function dragFrom(selector) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  });
  await page.waitForTimeout(100);

  const box = await page.locator(selector).first().boundingBox();
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);

  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 10 }] });
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(600);

  return page.evaluate(() => {
    const active = document.activeElement;
    return {
      scrollY: window.scrollY,
      selectedText: (window.getSelection() || { toString: () => "" }).toString(),
      inputRange: active && active.tagName === "INPUT" && active.selectionStart !== active.selectionEnd,
    };
  });
}

const fromClue = await dragFrom("#grid .cell.clue");
const fromLetter = await dragFrom("#grid .cell.letter");
check("dragging from a clue cell scrolls the page", fromClue.scrollY > 0, `scrollY ${fromClue.scrollY}`);
check("dragging from a letter cell scrolls the page too", fromLetter.scrollY > 0, `scrollY ${fromLetter.scrollY}`);
check("dragging a letter cell selects no text", fromLetter.selectedText === "", `selected "${fromLetter.selectedText}"`);
check("dragging a letter cell leaves no selection range in the input", !fromLetter.inputRange);

// --- readable cells, and a grid that scrolls sideways ------------------
// The reason the grid was being pinch-zoomed at all: cells shrank to fit
// the viewport, which drove clue type down to ~7px. Cells now hold a
// floor and .grid-wrap scrolls instead.
const layout = await page.evaluate(() => {
  const wrap = document.querySelector(".grid-wrap");
  const clues = [...document.querySelectorAll(".clue-text")];
  return {
    cell: Math.round(document.querySelector("#grid .cell").getBoundingClientRect().width),
    wrapClient: wrap.clientWidth,
    wrapScroll: wrap.scrollWidth,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clipped: clues.filter((t) => t.scrollWidth > t.clientWidth + 0.5 || t.scrollHeight > t.clientHeight + 0.5).length,
    minFont: Math.min(...clues.map((t) => parseFloat(getComputedStyle(t).fontSize))),
  };
});
check("cells clear the 44px touch-target minimum", layout.cell >= 44, `${layout.cell}px`);
check("a big grid is wider than the screen, so there is something to swipe", layout.wrapScroll > layout.wrapClient);
check("only the grid scrolls sideways, never the page", layout.pageOverflow === 0, `page overflows ${layout.pageOverflow}px`);
check("no clue is cut off", layout.clipped === 0, `${layout.clipped} clipped`);

// The flip side: a grid that fits must not scroll. Cells give up a couple
// of pixels below the floor rather than turn a 3px overhang into a
// scrolling surface.
const small = await page.evaluate(async () => {
  const lvl = ladder.levels.filter((l) => l.cols <= 8).sort((a, b) => a.cols - b.cols)[0];
  await loadLadderLevel(lvl.n);
  const wrap = document.querySelector(".grid-wrap");
  return {
    cols: puzzle.cols,
    cell: Math.round(document.querySelector("#grid .cell").getBoundingClientRect().width),
    overflow: wrap.scrollWidth - wrap.clientWidth,
  };
});
check("a grid that nearly fits does not scroll", small.overflow === 0, `${small.cols}col overflows ${small.overflow}px`);
check("and its cells stay within a hair of the touch minimum", small.cell >= 41, `${small.cell}px`);

// Back to the big grid for the gesture checks below.
await page.evaluate((n) => loadLadderLevel(n), bigN);
await page.waitForFunction(() => document.querySelectorAll("#grid .cell.letter").length > 0, null, { timeout: 20000 });

// Swiping horizontally must move the grid, from a letter cell as much as
// from a clue cell - that is the reported gesture.
async function swipeGrid(selector) {
  await page.evaluate(() => {
    document.querySelector(".grid-wrap").scrollLeft = 0;
  });
  await page.waitForTimeout(100);
  const box = await page.locator(selector).first().boundingBox();
  const y = Math.round(box.y + box.height / 2);
  const x0 = Math.round(box.x + box.width / 2);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 12; i++) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 - i * 10, y }] });
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(600);
  return page.evaluate(() => document.querySelector(".grid-wrap").scrollLeft);
}
const swipeClue = await swipeGrid("#grid .cell.clue");
const swipeLetter = await swipeGrid("#grid .cell.letter");
check("swiping the grid from a clue cell scrolls it", swipeClue > 0, `scrollLeft ${swipeClue}`);
check("swiping the grid from a letter cell scrolls it too", swipeLetter > 0, `scrollLeft ${swipeLetter}`);

// Typing walks across the grid; the cursor must not walk off the screen.
const followed = await page.evaluate(() => {
  const wrap = document.querySelector(".grid-wrap");
  wrap.scrollLeft = 0;
  // Pick the word that reaches furthest right, so its tail starts off-screen.
  const w = puzzle.words
    .filter((x) => x.dir === "across")
    .sort((a, b) => b.cells[b.cells.length - 1][1] - a.cells[a.cells.length - 1][1])[0];
  const last = w.cells[w.cells.length - 1];
  const before = document.getElementById("grid").children[last[0] * puzzle.cols + last[1]].getBoundingClientRect();
  const wrapBox = wrap.getBoundingClientRect();
  const startedOffScreen = before.right > wrapBox.right;
  focusCell(last[0] + "-" + last[1]);
  const after = document.getElementById("grid").children[last[0] * puzzle.cols + last[1]].getBoundingClientRect();
  return { startedOffScreen, visible: after.left >= wrapBox.left - 1 && after.right <= wrapBox.right + 1 };
});
check("the far end of a word starts off-screen", followed.startedOffScreen, "otherwise the next check proves nothing");
check("focusing a cell scrolls it into view", followed.visible);

// --- the clue bar ------------------------------------------------------
const bar = await page.evaluate(() => {
  const w = puzzle.words.find((x) => x.dir === "down") || puzzle.words[0];
  selectWord(w.id, false);
  const el = document.getElementById("cluebar");
  return {
    hidden: el.hidden,
    text: document.getElementById("cluebarText").textContent,
    expected: w.clue,
    dir: document.getElementById("cluebarDir").textContent,
    len: document.getElementById("cluebarLen").textContent,
    fontPx: parseFloat(getComputedStyle(document.getElementById("cluebarText")).fontSize),
    gridFontPx: parseFloat(getComputedStyle(document.querySelector(".clue-text")).fontSize),
  };
});
check("selecting a word shows its clue in the bar", !bar.hidden && bar.text === bar.expected, bar.text);
check("the bar shows the direction", bar.dir === "↓" || bar.dir === "→", bar.dir);
check("the bar is readable, unlike the in-grid copy", bar.fontPx >= 15 && bar.fontPx > bar.gridFontPx, `${bar.fontPx}px vs ${bar.gridFontPx}px in grid`);

// Ukrainian counts agree: 3 літери, 5 літер, 1 літера.
const plurals = await page.evaluate(() => [1, 2, 3, 4, 5, 11, 12, 21].map((n) => letterCountLabel(n)));
check(
  "letter counts agree in Ukrainian",
  JSON.stringify(plurals) ===
    JSON.stringify(["1 літера", "2 літери", "3 літери", "4 літери", "5 літер", "11 літер", "12 літер", "21 літера"]),
  plurals.join(", ")
);

// --- panning and pinching never cost the selection --------------------
// The player must be able to wander anywhere, at any zoom, and come back
// to find the word they were on still selected. That means DOM focus is
// released the moment a pan or pinch starts (otherwise the browser keeps
// dragging the focused input back into view) while every bit of the
// selection - active word, highlight, focused cell, clue bar - survives.
async function touchPan(selector, dx, dy) {
  const box = await page.locator(selector).first().boundingBox();
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + (dx / 10) * i, y: y + (dy / 10) * i }],
    });
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
}

const selectionBefore = await page.evaluate(() => {
  const w = puzzle.words.find((x) => !lockedWords.has(x.id));
  selectWord(w.id, true);
  return { wordId: activeWordId, focusedKey, clue: document.getElementById("cluebarText").textContent };
});

await touchPan("#grid .cell.letter", -140, -60);

const afterPan = await page.evaluate((before) => ({
  wordId: activeWordId,
  focusedKey,
  clue: document.getElementById("cluebarText").textContent,
  barVisible: !document.getElementById("cluebar").hidden,
  highlighted: document.querySelectorAll("#grid .cell.highlight").length,
  focusedMark: document.querySelectorAll("#grid .cell.focused").length,
  scrolled: document.querySelector(".grid-wrap").scrollLeft,
  same: activeWordId === before.wordId && focusedKey === before.focusedKey,
}), selectionBefore);

check("the pan actually moved the grid", afterPan.scrolled > 0, `scrollLeft ${afterPan.scrolled}`);
check("the selected word survives a pan", afterPan.same, `${afterPan.wordId} / ${afterPan.focusedKey}`);
check("the word stays highlighted", afterPan.highlighted > 0 && afterPan.focusedMark === 1);
check("the clue bar keeps showing that word's clue", afterPan.barVisible && afterPan.clue === selectionBefore.clue);

// And the grid must stay where it was put. With no focused input there is
// nothing the browser wants to scroll back to, which is precisely why
// this now holds without any special handling.
const settled = await page.evaluate(() => document.querySelector(".grid-wrap").scrollLeft);
await page.waitForTimeout(500);
check(
  "the grid stays where it was panned to",
  (await page.evaluate(() => document.querySelector(".grid-wrap").scrollLeft)) === settled,
  "something scrolled it back"
);

// Two-finger touch: a pinch must not disturb the selection either.
await page.evaluate(() => {
  const w = puzzle.words.find((x) => !lockedWords.has(x.id));
  selectWord(w.id, true);
});
const beforePinch = await page.evaluate(() => ({ wordId: activeWordId, focusedKey }));
await client.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [
    { x: 120, y: 400, id: 1 },
    { x: 220, y: 400, id: 2 },
  ],
});
await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(100);
const afterPinch = await page.evaluate((before) => ({
  same: activeWordId === before.wordId && focusedKey === before.focusedKey,
  barVisible: !document.getElementById("cluebar").hidden,
}), beforePinch);
check("pinching keeps the selection", afterPinch.same && afterPinch.barVisible);

// Typing must still work straight after panning - no re-tap needed, since
// the keyboard is on screen and the selection never went anywhere.
const resumed = await page.evaluate(() => {
  const w = puzzle.words.find((x) => !lockedWords.has(x.id));
  selectWord(w.id, true);
  const k = focusedKey;
  const before = getLetter(k);
  typeLetter(w.answer[0]);
  return { k, before, after: getLetter(k), expected: w.answer[0] };
});
check("typing works immediately after a pan, with no re-tap", resumed.after === resumed.expected, `${resumed.before} -> ${resumed.after}`);

// --- the keyboard can be folded away ----------------------------------
const folded = await page.evaluate(() => {
  document.getElementById("keyboardToggle").click();
  const hidden = document.getElementById("keyboard").hidden;
  document.getElementById("keyboardToggle").click();
  return { hidden, backAgain: !document.getElementById("keyboard").hidden };
});
check("the keyboard can be hidden for a full view of the grid", folded.hidden);
check("and brought back", folded.backAgain);

// And it is not left hanging around outside a puzzle.
await page.click("#backBtn");
check("the keyboard is gone on the level list", await page.evaluate(() => document.getElementById("keyboard").hidden));
await page.evaluate((n) => loadLadderLevel(n), bigN);
await page.waitForFunction(() => document.querySelectorAll("#grid .cell.letter").length > 0, null, { timeout: 20000 });
check("and back when a puzzle opens", await page.evaluate(() => !document.getElementById("keyboard").hidden));

// A solved word is no longer "in play", so the bar must clear.
const cleared = await page.evaluate(() => {
  const w = puzzle.words.find((x) => !lockedWords.has(x.id)) || puzzle.words[0];
  selectWord(w.id, false);
  w.cells.forEach(([r, c], i) => {
    const k = r + "-" + c;
    if (lockedCells.has(k)) return;
    focusCell(k);
    typeLetter(w.answer[i]);
  });
  return { hidden: document.getElementById("cluebar").hidden, locked: lockedWords.has(w.id) };
});
check("completing the selected word locks it and clears the bar", cleared.locked && cleared.hidden);

await page.screenshot({ path: "/tmp/scanword-mobile.png" });
await browser.close();
server.closeAllConnections();
await new Promise((r) => server.close(r));

console.log(`${passed} passed, ${failures.length} failed  (played a ${dims.rows}x${dims.cols} grid on an iPhone 13 viewport)`);
if (failures.length) {
  failures.forEach((f) => console.log("  FAIL: " + f));
  process.exit(1);
}
