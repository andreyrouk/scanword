// Mobile grid interaction.  node tools/test-mobile.mjs
//
// Covers the touch-drag fix and the typing behaviour it depends on.
//
// What this can and cannot prove: the reported symptom is iOS Safari's
// text-selection magnifier hijacking a drag that starts on a letter cell,
// and no engine available here renders that UI - Chromium pans on inputs
// where iOS selects. So these tests verify the *mechanism* (selection is
// off on the input, no selection range is ever created by a tap) and,
// more importantly, that the changes made to achieve it did not break
// typing, which is where the actual regression risk lives. Confirming the
// magnifier is gone needs a real iPhone.

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

// --- the mechanism ----------------------------------------------------
const sel = await page.evaluate(() => {
  const input = document.querySelector("#grid .cell.letter input");
  const cs = getComputedStyle(input);
  const clue = document.querySelector("#grid .cell.clue");
  return {
    input: cs.userSelect || cs.webkitUserSelect,
    touchAction: cs.touchAction,
    clue: clue ? getComputedStyle(clue).userSelect : null,
  };
});
check("letter input does not take text selection", sel.input === "none", `got "${sel.input}"`);
check(
  "letter cells match clue cells, which already dragged fine",
  sel.input === sel.clue,
  `input "${sel.input}" vs clue "${sel.clue}"`
);
check("double-tap-to-zoom is off inside the grid", sel.touchAction === "manipulation", `got "${sel.touchAction}"`);

// A tap must leave a collapsed caret, never a selection range - the range
// is what summons the magnifier and the drag handles.
const firstKey = await page.evaluate(() => {
  const w = puzzle.words[0];
  const [r, c] = w.cells[1]; // not the first cell, to catch off-by-one focus
  return r + "-" + c;
});
await page.evaluate((k) => cellEls[k].dispatchEvent(new MouseEvent("click", { bubbles: true })), firstKey);
const caret = await page.evaluate((k) => {
  const i = inputEls[k];
  return { start: i.selectionStart, end: i.selectionEnd, focused: document.activeElement === i };
}, firstKey);
check("tapping a cell focuses it", caret.focused);
check("tapping a cell creates no selection range", caret.start === caret.end, `${caret.start}-${caret.end}`);

// --- typing still works (the regression risk of removing select()) ----
await page.keyboard.type("Ж");
check("typing into an empty cell writes the letter", (await page.evaluate((k) => inputEls[k].value, firstKey)) === "Ж");

// Re-tap the filled cell and type again: it must replace, not be ignored.
// This is what maxLength=1 + select() used to guarantee.
await page.evaluate((k) => cellEls[k].dispatchEvent(new MouseEvent("click", { bubbles: true })), firstKey);
await page.keyboard.type("Ц");
check(
  "typing into a filled cell replaces the letter",
  (await page.evaluate((k) => inputEls[k].value, firstKey)) === "Ц",
  "maxLength=1 would have silently rejected this"
);

// The nastier case: caret parked at the start, which is where a tap on the
// left half of a filled cell leaves it if focusCell did not intervene.
await page.evaluate((k) => {
  const i = inputEls[k];
  i.focus();
  i.setSelectionRange(0, 0);
}, firstKey);
await page.keyboard.type("Б");
check(
  "typing replaces even with the caret before the letter",
  (await page.evaluate((k) => inputEls[k].value, firstKey)) === "Б",
  "a naive slice(-1) would keep the old letter here"
);

// A cell never holds more than one character, whatever gets thrown at it.
await page.evaluate((k) => {
  const i = inputEls[k];
  i.focus();
  i.value = "СЛОВО";
  i.dispatchEvent(new Event("input", { bubbles: true }));
}, firstKey);
check("a multi-character paste collapses to one letter", (await page.evaluate((k) => inputEls[k].value, firstKey)) === "О");

// --- solving by typing, on touch --------------------------------------
await page.evaluate((k) => {
  inputEls[k].value = "";
}, firstKey);
const typed = await page.evaluate(async () => {
  // Type every answer through the real input path rather than assigning
  // values, so handleInput/advance/lock are all exercised.
  for (const w of puzzle.words) {
    w.cells.forEach(([r, c], i) => {
      const input = inputEls[r + "-" + c];
      input.value = "";
      input.focus();
      input.value = w.answer[i];
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  return { solved: puzzleSolved, locked: lockedWords.size, total: puzzle.words.length };
});
check("a full grid still solves through the input path", typed.solved && typed.locked === typed.total, JSON.stringify(typed));

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
check("a word is selected and focused to begin with", await page.evaluate(() => document.activeElement.tagName === "INPUT"));

await touchPan("#grid .cell.letter", -140, -60);

const afterPan = await page.evaluate((before) => ({
  stillFocusedInput: document.activeElement && document.activeElement.tagName === "INPUT" && !!document.activeElement.closest(".cell"),
  wordId: activeWordId,
  focusedKey,
  clue: document.getElementById("cluebarText").textContent,
  barVisible: !document.getElementById("cluebar").hidden,
  highlighted: document.querySelectorAll("#grid .cell.highlight").length,
  focusedMark: document.querySelectorAll("#grid .cell.focused").length,
  scrolled: document.querySelector(".grid-wrap").scrollLeft,
  same: activeWordId === before.wordId && focusedKey === before.focusedKey,
}), selectionBefore);

check("panning releases the caret, so the browser stops chasing it", !afterPan.stillFocusedInput);
check("the pan actually moved the grid", afterPan.scrolled > 0, `scrollLeft ${afterPan.scrolled}`);
check("the selected word survives a pan", afterPan.same, `${afterPan.wordId} / ${afterPan.focusedKey}`);
check("the word stays highlighted", afterPan.highlighted > 0 && afterPan.focusedMark === 1);
check("the clue bar keeps showing that word's clue", afterPan.barVisible && afterPan.clue === selectionBefore.clue);

// And the grid must stay where it was put - no snap-back to the caret.
const settled = await page.evaluate(() => document.querySelector(".grid-wrap").scrollLeft);
await page.waitForTimeout(500);
check(
  "the grid stays where it was panned to",
  (await page.evaluate(() => document.querySelector(".grid-wrap").scrollLeft)) === settled,
  "something scrolled it back"
);

// A pinch is two fingers and is never a tap: drop the caret immediately.
await page.evaluate(() => {
  const w = puzzle.words.find((x) => !lockedWords.has(x.id));
  selectWord(w.id, true);
});
await client.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [
    { x: 120, y: 400, id: 1 },
    { x: 220, y: 400, id: 2 },
  ],
});
await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(100);
const afterPinch = await page.evaluate(() => ({
  focused: document.activeElement && document.activeElement.tagName === "INPUT" && !!document.activeElement.closest(".cell"),
  wordId: activeWordId,
  barVisible: !document.getElementById("cluebar").hidden,
}));
check("pinching releases the caret too", !afterPinch.focused);
check("pinching keeps the selection", afterPinch.wordId !== null && afterPinch.barVisible);

// A tap has some travel in it; that must not be mistaken for a pan and
// close the keyboard on someone who is trying to type.
await page.evaluate(() => {
  const w = puzzle.words.find((x) => !lockedWords.has(x.id));
  selectWord(w.id, true);
});
await touchPan("#grid .cell.letter", 4, 3);
check(
  "a slightly sloppy tap keeps the caret",
  await page.evaluate(() => document.activeElement && document.activeElement.tagName === "INPUT" && !!document.activeElement.closest(".cell")),
  "the pan threshold is too tight"
);

// Tapping back in resumes typing where the player left off.
const resumed = await page.evaluate(() => {
  const w = puzzle.words.find((x) => !lockedWords.has(x.id));
  const [r, c] = w.cells[0];
  cellEls[r + "-" + c].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const focused = document.activeElement === inputEls[r + "-" + c];
  document.activeElement.value = w.answer[0];
  document.activeElement.dispatchEvent(new Event("input", { bubbles: true }));
  return { focused, wrote: inputEls[r + "-" + c].value === w.answer[0] };
});
check("tapping a cell after panning restores the caret", resumed.focused);
check("and typing works again immediately", resumed.wrote);

// A solved word is no longer "in play", so the bar must clear.
const cleared = await page.evaluate(() => {
  const w = puzzle.words.find((x) => !lockedWords.has(x.id)) || puzzle.words[0];
  selectWord(w.id, false);
  w.cells.forEach(([r, c], i) => {
    const input = inputEls[r + "-" + c];
    input.value = "";
    input.focus();
    input.value = w.answer[i];
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return document.getElementById("cluebar").hidden;
});
check("completing the selected word clears the bar", cleared);

await page.screenshot({ path: "/tmp/scanword-mobile.png" });
await browser.close();
server.closeAllConnections();
await new Promise((r) => server.close(r));

console.log(`${passed} passed, ${failures.length} failed  (played a ${dims.rows}x${dims.cols} grid on an iPhone 13 viewport)`);
if (failures.length) {
  failures.forEach((f) => console.log("  FAIL: " + f));
  process.exit(1);
}
