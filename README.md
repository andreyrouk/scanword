# Сканворд

A Ukrainian scanword (сканворд) web app. Standalone HTML/CSS/JS, no build
step, deployable straight to GitHub Pages.

Unlike a standard crossword, a scanword has no separate clue list and no
black/blocked cells: every cell in the grid is either a clue (short text +
an arrow showing where the answer starts and which way it runs) or a
letter. Words are generated fresh in the browser from a Ukrainian
word+clue dictionary, laid out to interlock the way a real scanword does.

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
  seeded with a few hundred entries. `word` is uppercase Cyrillic letters
  only (no apostrophes/hyphens/spaces, since each cell holds one
  character); `clue` is a short definition that doesn't reuse the word.
- `js/grid-skeleton.js` - decides, for a given grid size, which cells are
  clue cells and which are letters, with every row/column split into
  word-length runs and no black cells anywhere. This is randomized
  generate-and-validate: build a candidate layout, reject it if it has an
  orphan letter (part of no word) or a dead interior clue cell (points at
  nothing), retry with a new random layout otherwise.
- `js/word-filler.js` - assigns dictionary words to the grid's word slots
  via backtracking search with a minimum-remaining-values heuristic
  (always fill in whichever slot currently has the fewest matching
  candidates next), so crossing letters agree everywhere.
- `js/generator.js` - orchestrates the above, retrying with fresh random
  skeletons within a time budget, and assembles the renderable puzzle
  model (word list + which cell holds which clue(s)).
- `js/app.js` - rendering and the interaction mechanic: click a clue to
  jump to its word; click a crossing cell to toggle between its two
  words (vertical wins the first click, matching a real scanword);
  typing fills a letter and advances, skipping over already-locked
  cells; completing a word correctly locks it.

## Known limitation: dictionary size vs. grid size

How many *distinct* words a grid needs - and how many of them must share
the exact same length while all crossing each other - grows much faster
than grid area. A 5x5 or 6x5 grid reliably generates in well under a
second with the current dictionary. Bigger grids (8x8 and up) need enough
words of matching lengths to satisfy many simultaneous crossings, and
will sometimes fail to generate within the time budget until the
dictionary is larger. `js/generator.js` gives up gracefully (time-budgeted
retries, then a clear on-screen message) rather than hanging - so this
shows up as "try a smaller grid," not a crash.

There's also a rarer cosmetic case: the generator can occasionally leave a
border clue cell unused by any word. Rather than force every grid into a
much harder shape to eliminate this, those cells render as a small sage
ornament (part of the paper-frame design) rather than a solid block, so
they never look like a forbidden black/blocked square.

Both of these get less noticeable as the dictionary grows.

## Roadmap

- Grow `data/dictionary.js` toward ~10,000 entries, which is what actually
  unlocks bigger, denser grids reliably.
- Daily/scheduled puzzle generation.
- Difficulty levels (grid size + word rarity).
- A creation mode: let users build and publish their own puzzle with the
  same grid engine.
- Monetized hints (reveal a letter/word) for players who get stuck.
