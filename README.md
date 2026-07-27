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
  clue cells and which are letters. This is a real constraint solver
  (backtracking with pruning), not generate-and-hope: every single cell is
  guaranteed to end up either the clue for a real word or a letter inside
  one - no black cells, no filler, no cell (not even the corner) that
  renders with nothing in it. A valid layout is *found*, not gambled on.
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

## Known limitation: performance and crossing density at larger sizes

Two related things get harder fast as grid area grows, independent of
each other:

- **Finding a valid, fully-tiled shape at all.** The skeleton search in
  `js/grid-skeleton.js` is exhaustive-with-pruning, and the space it's
  searching grows exponentially with cell count. 5x5 and 6x5 grids solve
  in well under a second; 6x6 can take several seconds; much beyond that
  and it needs real algorithmic work (better pruning, or a fundamentally
  smarter search) to stay fast. `js/generator.js` runs this within a wall-
  clock budget and fails gracefully with an on-screen message rather than
  hanging, so this shows up as "try a smaller grid," not a crash.
- **How densely words cross.** A layout can be perfectly valid (zero
  waste) while still having most words sit side-by-side rather than
  interlocking - real scanwords interlock much more. `generatePuzzle`
  samples a few valid layouts and keeps the most densely-crossed one, but
  for small grids there's a hard ceiling on how much crossing is even
  possible (there's provably no 100%-crossing layout for a 5x5 grid under
  these rules, for instance) - it takes a bigger grid to get the dense,
  reference-photo look.
- **Word/clue count vs. dictionary size**, as before: many simultaneous
  same-length crossings need many candidate words to satisfy them all at
  once.

All three get better with a bigger dictionary and more algorithm work -
neither is a correctness problem, both are "the next thing to improve."

## Roadmap

- Grow `data/dictionary.js` toward ~10,000 entries, which is what actually
  unlocks bigger, denser grids reliably.
- Daily/scheduled puzzle generation.
- Difficulty levels (grid size + word rarity).
- A creation mode: let users build and publish their own puzzle with the
  same grid engine.
- Monetized hints (reveal a letter/word) for players who get stuck.
