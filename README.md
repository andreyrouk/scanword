# Сканворд

A Ukrainian scanword (сканворд) web app. Standalone HTML/CSS/JS, no build
step, deployable straight to GitHub Pages - and installable to a phone's
home screen, where it plays completely offline.

Unlike a standard crossword, a scanword has no separate clue list: every
letter cell is part of a word, and each word's clue sits in a nearby cell
with an arrow pointing to where the answer starts. There are no
black/blocked cells. Words are generated fresh in the browser from a
Ukrainian word+clue dictionary.

## Running it

Just serve the folder statically (or open `index.html` directly) - there's
nothing to build or install:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Deploying to GitHub Pages: Settings →
Pages → Source: `main` branch, `/ (root)`.

Note that the service worker only registers over `http://localhost`,
`http://127.0.0.1` or HTTPS - browsers require a secure context for it, and
`file://` isn't one. Opening `index.html` directly still plays fine, it
just won't install or cache.

## How it works

- `data/dictionary.js` - the Ukrainian word + clue dictionary, currently
  10,000 entries. `word` is uppercase Cyrillic letters only (no
  apostrophes/hyphens/spaces, since each cell holds one character);
  `clue` is a short definition that doesn't reuse the word.
- `js/grid-skeleton.js` - decides which cells are clues and which are
  letters, and which clue explains which word. Key insight (borrowed
  from print scanwords): a clue does not have to sit directly before its
  word - it sits in any cell adjacent to the word's first letter, with a
  possibly-bent arrow (→ ↓ ↳ ✴︎⬎) showing where the word starts and which
  way it runs. Construction is word-first backtracking: scanning the
  grid, every uncovered cell becomes a clue that grows 1-2 words out of
  itself, with full undo when a branch dead-ends. Every letter belongs
  to a word, every clue explains 1-2 words, no cell is wasted, and no
  run of letters ever exists without being a real clued word - all hard
  guarantees, re-audited independently after generation.
- `js/word-filler.js` - assigns dictionary words to the grid's word slots
  via backtracking with a minimum-remaining-values heuristic (always fill
  in whichever slot currently has the fewest matching candidates next),
  so crossing letters agree everywhere.
- `js/generator.js` - pairs fresh skeletons with word-fill attempts within
  a time budget, and assembles the renderable puzzle model.
- `js/app.js` - rendering and the interaction mechanic: click a clue to
  jump to its word; click a crossing cell to toggle between its two words
  (vertical wins the first click, matching a real scanword); typing fills
  a letter and advances, skipping over already-locked cells; completing a
  word correctly locks it. Every cell is rendered as a fixed square
  (`js/app.js` sets both grid dimensions to the same pixel size) - a clue
  cell with a lot of text clips/scales down rather than stretching the
  row.

## Playing on a phone

Three things have to hold at once on a small screen: the clue has to be
readable, the cell has to be tappable, and the grid has to be navigable.
They pull against each other, and the app resolves them like this.

**Cells never shrink below 44px** (`MIN_CELL_PX` in `js/app.js`). Before,
cells were sized purely to fit the viewport width, which gave an
11-column grid 32px cells on an iPhone. That is too small twice over:
44px is the minimum touch target in Apple's HIG, and the median clue is
33 characters - fitting 33 characters in a square of side S caps the font
at about S/4.6, so 32px cells meant ~7px type. Unreadable type is what
drove players to pinch-zoom, and pinch-zoom is what dragged badly.

**The grid scrolls sideways instead of shrinking.** Past 8 columns the
grid is deliberately wider than the screen and `.grid-wrap` is the
surface you swipe - the supported, momentum-scrolled version of what
pinch-zoom-and-drag was being used for. Two details this depends on:
`.grid` needs `width: max-content`, or its `overflow: hidden` (which
rounds the corners) silently *clips* the right-hand columns instead of
letting them scroll; and `cellSizePx` counts the 1px gaps and border, or
a grid overflows by a handful of pixels and scrolls for nothing. Grids
that miss fitting by up to `FIT_TOLERANCE_PX` give up those pixels rather
than become scrollable at all.

**`keepCellInView` follows the cursor.** Typing walks across a grid wider
than the screen, so focusing a cell scrolls `.grid-wrap` just enough to
show it. Deliberately not `scrollIntoView()`, which walks every
scrollable ancestor including the page and would fight the browser's own
scroll-into-view for a focused input with the keyboard open.

**The clue bar is the readable copy.** In-grid clue text is capped by the
cell no matter how the grid is sized - a 33-character clue in a 44px cell
still only gets ~9px. The bar above the grid shows the clue for the word
in play at full size, with its direction and letter count, so reading a
clue never requires zooming.

**Panning and zooming are free.** Nothing in the grid takes DOM focus, so
there is no focused input for the browser to scroll back into view and no
caret to fight - see Entering letters below.

## Entering letters

**No cell is a form field.** Letter cells hold a plain `<span>`, the
entered letters live in a `letters` map in `js/app.js`, and all input
arrives through `typeLetter()` / `backspaceLetter()` / `moveFocus()`. This
one decision is what makes the rest work:

- **The OS keyboard never opens.** A player whose phone is set to English
  would otherwise have to switch layouts to type a single answer, and the
  system keyboard opened and closed as focus moved between cells,
  resizing the viewport under the grid every time.
- **There is no caret.** Every mobile bug this project hit came from
  having ~100 real text inputs in a grid: iOS raising its selection
  magnifier on a drag that started in one, the browser scrolling the
  focused input back into view and fighting the player's pan, the
  keyboard reflowing the page. None of those are patched - they cannot
  happen.
- **Selection is app state** - `activeWordId`, the highlight, the
  `.focused` cell, the clue bar. Panning or pinching anywhere costs
  nothing, because there is no DOM focus to lose and nothing the browser
  wants to scroll back to.

Since there is no caret, the focused cell draws its own outline
(`.cell.letter.focused::after`).

**The in-app keyboard** is standard Ukrainian ЙЦУКЕН (`KEYBOARD_ROWS`),
pinned to the bottom of the viewport with `position: fixed` - the page
scrolls, and a keyboard you have to scroll to reach is worse than the one
it replaced. `#playScreen` reserves exactly its height via `--kb-height`,
measured in `updateKeyboardVisibility()` rather than hardcoded because the
safe-area inset varies by device. It can be folded away for a full view of
a large grid.

Note which letters it has: the 33 of the Ukrainian alphabet and no others.
Ё, Ъ, Ы and Э are Russian and appear in no Ukrainian word, so a keystroke
producing one is not a letter this game accepts. Ґ is included even though
no answer in the current 100 levels uses it.

**Physical keyboards still work** - this is a website too. Keys are
resolved by `normalizeTypedKey()`, which accepts a Ukrainian letter
directly and otherwise maps the key's *position* through `QWERTY_TO_UK`.
That is the desktop half of the same problem: someone whose laptop is set
to English can touch-type Ukrainian without installing a layout. The
document-level handler stays out of the way whenever a real form field has
focus, or the custom-grid row/column boxes would become untypeable.

`node tools/test-mobile.mjs` covers all of this on an iPhone 13 viewport
with real touch events: that the grid contains no form field at all, the
keyboard's exact letter inventory, entry/backspace/cursor keys, the
QWERTY-position mapping, rejection of Russian-only letters, solving a full
grid through the entry path, and selection surviving pans and pinches.
Only Chromium is available here, so iOS-specific UI still can't be
rendered - but the structure that made those bugs possible is asserted
directly, which is stronger than testing around it.

One testing trap worth remembering: Playwright's `keyboard.type()` sends
non-ASCII through `Input.insertText`, which never fires a `keydown`, so it
cannot exercise a keydown handler. Cyrillic key tests dispatch
`KeyboardEvent` directly.

## Current limits

The "custom size" generator in the UI runs the full search live in the
browser and is capped at 10x10, because that's the largest size that
reliably finishes within a UI-reasonable time budget - it usually takes
well under a second, occasionally up to ~15-30s on the harder end. Bigger
than that isn't a dictionary-size problem (10,000 entries covers every
word length from 3 to 12 with 1,000+ candidates apiece); it's that a
scanword has zero black cells, so tiling a bigger grid with no slack
anywhere gets combinatorially harder for the backtracking construction in
`grid-skeleton.js` to solve, independent of word supply. Measured
directly: 12x12 fails to even find a valid *shape* (no dictionary
involved yet) in the large majority of attempts, even given a full 2
minutes per attempt - it's a real algorithmic wall for this construction
approach, not just an insufficient time budget.

That wall doesn't block bigger puzzles from existing, though - see
Levels below, which sidesteps it entirely by not generating on request.

## Levels

Puzzles the app actually serves to players come from `data/levels/`, not
from live generation: `tools/generate-levels.mjs` runs the same generator
offline, with no user waiting on it, and saves the successes as static
JSON.

```
node tools/generate-levels.mjs easy 10      # -> data/levels/easy/*.json
node tools/generate-levels.mjs medium 10    # -> data/levels/medium/*.json
node tools/generate-levels.mjs hard 5       # -> data/levels/hard/*.json
```

Each run appends to `data/levels/manifest.json` (the file list per
difficulty) rather than overwriting it, so it's safe to run repeatedly to
grow the pool. Difficulty is a *range* of shapes, not one fixed size:
`TIERS` in the script gives each difficulty a min/max dimension and a max
area (easy roughly 6x6-8x8, medium up to ~12 a side, hard up to 18 a side
capped around 170 cells total) rather than committing to one exact
rows x cols. Measured directly: exact-shape difficulty isn't a clean
function of area - a 7x13 grid (91 cells) failed where a 9x12 grid (108
cells, more cells) succeeded - so pinning one specific rectangle before
knowing whether the dictionary tiles it that way is gambling. Instead,
`generateOne` tries a shuffled batch of candidate shapes within the
tier's range per puzzle and keeps whichever one the words actually
cooperate with - a real scanword doesn't have to be square, and this is
also where the variety comes from (a "hard" run might land 11x9, 9x14, or
10x10 - whatever worked). 12x12+ is excluded from every tier regardless
of shape, since patience alone doesn't clear that wall (see Current
limits).

In the browser, `js/app.js` fetches the manifest, picks a random file for
the chosen difficulty, and renders it - no search happens client-side at
all, so a level loads in well under a second regardless of its size. A
saved puzzle only stores `rows`/`cols`/`isClue`/`words`; `clueCells` is
fully derived from `words` (`buildClueCells()` in `js/generator.js`), so
it's rebuilt on load instead of duplicated in the file.

Clue text is stored inside each level file rather than looked up from the
dictionary at play time, which keeps a level self-contained and immune to
later dictionary edits - but also means a clue fixed in
`data/dictionary.js` is invisible to levels already on disk. Close that
gap with:

```
node tools/resync-level-clues.mjs          # report drift
node tools/resync-level-clues.mjs --fix    # rewrite levels in place
```

## The campaign ladder

`tools/build-ladder.mjs` scores every generated level and emits
`data/levels/ladder.json`: the ordered campaign, easiest first.

```
node tools/build-ladder.mjs --limit 100
```

Difficulty is a **provisional proxy**, not a measurement - nobody has
played these yet. It's a weighted blend of four things we can compute,
picked because they actually spread across the corpus: word count
(0.40 - widest spread, so it carries the most), share of rare or
unlisted answers (0.30), crossing density inverted since more crossings
hand the player more free letters (0.15), and average answer length
(0.15). Each is min-max normalised first, or the signal with the largest
raw numbers would dominate regardless of its weight.

The honest caveat: the frequency list only covers ~32% of dictionary
words, so "rare" conflates *genuinely obscure* with *absent from a noisy
corpus*. Both push a level later in the ladder, which is the right
direction, but it is not a true difficulty measure. Once real completion
times exist they should replace these weights outright - players are the
only reliable calibration, and the scoring system already records exactly
the data needed to do it.

A level's ladder position also decides its scoring tier (first third
easy, then medium, then hard) rather than the folder it was generated
into, so the multiplier a player receives matches the difficulty they
actually faced.

## Progress

`js/progress.js` keeps campaign progress in `localStorage` - stars, best
points, best time, and hint count per level. No accounts, no backend, no
network: everything the campaign needs is per-device data no server has
to arbitrate. Only the future daily leaderboard genuinely requires one,
because that's the only place results are compared between players and
therefore worth cheating at.

Best values are tracked per field, not per attempt: stars, points and
time can each come from a different run (a cautious hint-free solve earns
the stars, a later confident replay sets the time). Unlocking is
sequential - finishing a level opens the next - deliberately rather than
star-gated, since a star gate can strand a player who finished everything
but can't reach the threshold, which reads as punishment rather than
challenge. Storage failures (Safari private mode, exhausted quota) fall
back to in-memory rather than breaking the game.

## Installing it as an app

The app is a PWA: `manifest.webmanifest` plus `sw.js` make it installable
to a phone's home screen (Chrome's "Install app", iOS Safari's "Add to
Home Screen"), where it launches without browser chrome and works with no
connection at all. `tools/make-icons.mjs` renders the icons.

Caching is split by what the file actually is. Level JSON, icons and the
dictionary are immutable - once published their contents never change, so
they're served cache-first and never revalidated. The app shell (HTML,
CSS, JS, the ladder) is stale-while-revalidate: instant from cache, with
a background refresh so a fix lands on the next launch instead of never.
Bump `CACHE_VERSION` in `sw.js` when the precache list changes; activate
deletes every older cache.

The ~1MB `data/dictionary.js` is deliberately **not** precached, and no
longer loads at startup either - `js/app.js` injects it on demand. Only
the custom-grid generator needs it; the 100 ladder levels and the daily
ship with their words already baked in, so most players never pay for it.
That splits the payload:

| | |
|---|---|
| shell + ladder + icons | ~129K (blocks first render) |
| 100 level files | ~472K (precached in the background) |
| **offline install** | **~602K** |
| dictionary | ~988K, fetched only if someone opens "своя сітка" |

Previously all 1.6MB was fetched on every first load.

`node tools/test-pwa.mjs` verifies this end to end in Chromium: the worker
activates, the precache holds the shell and all 100 levels but not the
dictionary, and then - with the HTTP server actually shut down - the app
still opens, a level loads and can be solved, and the daily works. It
kills the origin rather than using Playwright's `setOffline`, because that
flag doesn't apply to fetches the service worker itself makes, so a cache
miss would quietly succeed over the network and the test would prove
nothing.

## Building a bigger dictionary

`tools/` holds the word-list pipeline. It is source-agnostic in shape but
currently wired to a frequency list:

```
node tools/fetch-wordlist.mjs    # downloads the raw frequency list
node tools/build-wordlist.mjs    # filters + ranks -> data/wordlist-candidates.json
```

**Why this source.** The best Ukrainian lexical resource is VESUM
(`brown-uk/dict_uk`), but its data is **CC BY-NC-SA - NonCommercial**, so
it cannot be used in a paid app. Nearly every other Ukrainian dictionary
(including the LibreOffice/hunspell one) derives from it and inherits that
restriction. The pipeline therefore uses `hermitdave/FrequencyWords`
(MIT), where the data are corpus-derived frequency counts.

**What it produces.** ~33k candidates; lengths 4-9 each clear the ~2,000
target, length 3 tops out around 1,100 (Ukrainian simply has few short
common nouns - the generator has to lean away from 3-letter slots).

**What it cannot do.** It yields a *candidate pool*, not a word list. Two
limits are measured, not assumed: the corpus is heavily polluted with
Russian, and shape rules alone cannot identify nouns. Excluding everything
that also appears in a Russian list is not viable - 36% of the curated
Ukrainian nouns appear there too, as genuine cognates. Both problems are
trivial for the clue-writing pass to settle, so that is where they are
resolved: one pass per batch that answers "is this a Ukrainian noun?" and,
if so, writes the clue - then human review.

## Viewing and adding words

The dictionary lives in `data/dictionary.js`. For reading or editing it,
`data/dictionary.csv` is the friendlier view - GitHub renders it as a
sortable table and it opens directly in Excel / Sheets / Numbers.

```
node tools/export-dictionary.mjs          # dictionary.js -> dictionary.csv
node tools/import-words.mjs mine.csv      # merge a file in
node tools/import-words.mjs mine.csv --dry-run   # validate without writing
```

`import-words.mjs` accepts one entry per line as `word<SEP>clue`, where
the separator can be a tab, semicolon, pipe, em-dash, or comma; quoted CSV
is parsed properly, so an exported file can be edited and fed straight
back. It validates every row and reports rejects with a reason rather than
dropping them silently:

- word must be Ukrainian letters only - no spaces, apostrophes or hyphens
  (a grid cell holds exactly one letter, so "М\'ЯЧ" can never be an answer)
- 3-12 letters
- clue must not contain its own answer or an obvious stem of it
- clue at most 70 characters - longer ones shrink to unreadable type
- no duplicates, within the file or against the existing dictionary

## Roadmap

- ~~Grow `data/dictionary.js` toward ~10,000 entries~~ - done.
- ~~Difficulty levels~~ - done as a grid-size tier (see Levels above);
  word-rarity-based difficulty within a size is still open.
- A smarter grid-skeleton construction (fill-aware, not generate-then-
  check) to push past the ~11x11 wall - see Current limits. Likely the
  highest-leverage next step if bigger puzzles are wanted, since neither
  more dictionary nor more offline patience clears it on their own.
- ~~Daily puzzle~~ - done, and picked client-side from the date rather
  than published by a server (see `js/daily.js`).
- ~~Installable, offline-capable app~~ - done as a PWA (see Installing it
  as an app).
- A backend: accounts and a daily leaderboard. The only piece here that
  genuinely needs a server - everything else is per-device data no one has
  to arbitrate, while a leaderboard is by definition comparison between
  players and therefore worth cheating at.
- Store distribution (Capacitor wrap of the same PWA) if the home-screen
  install proves not to be enough reach.
- Rules and Options screens - the menu buttons exist and are disabled.
- A clue-quality pass: `tools/review-clues.mjs` currently flags ~88 weak
  clues (mechanical, over-generic, or too long to read at grid size).
- A creation mode: let users build and publish their own puzzle with the
  same grid engine.
