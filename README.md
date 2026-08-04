# Сканворд

A Ukrainian scanword (сканворд) web app. Standalone HTML/CSS/JS, no build
step, deployable straight to GitHub Pages.

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
grow the pool. Difficulty is currently just a grid-size tier (easy 6-7,
medium 8-9, hard 10-11), configured in `TIERS` at the top of the script;
each tier gets a generous per-puzzle time budget since there's no live
user to keep waiting - the hard tier alone gave 11x11 a real, if slow
(order of tens of seconds), chance to succeed. 12x12+ is excluded even
here, since patience alone doesn't clear that wall (see Current limits).

In the browser, `js/app.js` fetches the manifest, picks a random file for
the chosen difficulty, and renders it - no search happens client-side at
all, so a level loads in well under a second regardless of its size. A
saved puzzle only stores `rows`/`cols`/`isClue`/`words`; `clueCells` is
fully derived from `words` (`buildClueCells()` in `js/generator.js`), so
it's rebuilt on load instead of duplicated in the file.

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
- Daily/scheduled puzzle generation (cron the batch generator, publish
  a "today's puzzle" pointer).
- A creation mode: let users build and publish their own puzzle with the
  same grid engine.
- Monetized hints (reveal a letter/word) for players who get stuck.
