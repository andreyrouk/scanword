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
- `js/grid-skeleton.js` - decides, for a given grid size, which cells are
  clues and which are letters. The one rule that actually matters: a run
  of letter cells is either a short stub (fine, no clue needed - relies
  on the crossing word instead) or a real word with a clue directly
  before it. A run starting at the grid's own edge (row 0 / column 0) can
  never have a clue there, so it can only ever be a stub - **never** a
  long, real-looking run with nothing spelling it out. That's the one
  thing a real scanword never does, and it's enforced everywhere, not
  just at the edges. Generation is randomized generate-and-validate:
  build a layout, keep it if every letter cell has a real word in some
  direction, retry otherwise.
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

## Known trade-off: occasional unused clue cells

Requiring *every* clue cell to serve a real word - on top of never
letting a long run go unclued - turns out to make grid generation
dramatically harder to find quickly (verified by exhaustive search: for
several grid sizes there is no such layout with a clue-starved corner
guaranteed used, and reliably constructing one needs real algorithmic
work well beyond a generate-and-check search). Rather than block on that,
a clue cell occasionally ends up not attached to any word. It renders as
a small dot - deliberately not a solid block, so it never reads as a
forbidden black/blocked square - not as blank filler pretending to be
useful. The unclued-long-run bug (real gibberish, cells that look exactly
like a word but spell nothing) is fully fixed; this is a narrower,
purely cosmetic gap that shrinks as the generator improves.

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
