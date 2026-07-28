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

- `data/dictionary.js` - the Ukrainian word + clue dictionary, currently a
  few hundred entries. `word` is uppercase Cyrillic letters only (no
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

With the ~1,100-word dictionary, 5x5 and 6x6 generate reliably (seconds).
Larger grids produce valid *shapes* fine, but their dense interlock needs
far more same-length crossing candidates than the dictionary has - fills
start failing around 7x6. The UI caps sizes at the reliable envelope; the
cap moves up as the dictionary grows toward ~10,000 entries.

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

## Roadmap

- Grow `data/dictionary.js` toward ~10,000 entries, which unlocks bigger,
  denser grids reliably (more simultaneous same-length crossings need
  more candidate words to satisfy them all at once).
- A smarter grid-skeleton construction (not just generate-and-check) to
  shrink how often a clue cell goes unused, and to make larger grids
  reliably fast.
- Daily/scheduled puzzle generation.
- Difficulty levels (grid size + word rarity).
- A creation mode: let users build and publish their own puzzle with the
  same grid engine.
- Monetized hints (reveal a letter/word) for players who get stuck.
