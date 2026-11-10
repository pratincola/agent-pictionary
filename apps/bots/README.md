# @pictionary/bots

Scripted drawer and guesser bots, an LLM guesser via OpenRouter, and the
`demo` / `race` commands. Build first (`pnpm build` at the root), then:

```sh
ap-bots demo   [--base URL] [--web-base URL] [--oracle-delay 25] [--llm]
ap-bots race   [--base URL] [--n 50]
ap-bots drawer --code CODE [--base URL] [--name N] [--index 0] [--duration 30]
ap-bots guesser --code CODE --strategy random-pool|pattern|oracle [--delay 25] [--jitter 2]
ap-bots llm-guesser --code CODE [--interval 8] [--max-calls 6] [--model google/gemini-2.5-flash]
```

## Stroke library

The scripted drawer (`LibraryDrawer`) picks the first word option it has a
drawing for and streams that drawing over ~30 s. Drawings are programmatic
(`src/library/drawings*.ts`) and checked in as JSON (`library/<word>.json`,
`{ word, ops: DrawOp[] }`) so other clients can use them without the TypeScript.

Coverage of `packages/engine/src/words/pool.json`:

| tier   | pool | drawn | missing                                   |
| ------ | ---- | ----- | ----------------------------------------- |
| easy   | 146  | 146   | none                                      |
| medium | 134  | 129   | school, library, zoo, jungle, glacier     |
| hard   | 100  | 0     | abstract words; the drawer falls back to `?` |

276 JSON files in all (the extra one is the `bike` alias of `bicycle`). The
five missing medium words were left out on purpose: as a plain line icon each
would read as a different pool word (`school` as `house`/`church`, `library`
as `book`, `zoo` as whatever animal is drawn, `jungle` as `tree`, `glacier` as
`mountain`). A word with no drawing gets the framed question-mark placeholder.

Rules every drawing follows (asserted in `test/library.test.ts`):

- 1000x1000 canvas, 6-80 ops, every op inside the canvas.
- Ink outlines plus at most two accent colors from `src/library/palette.ts`
  (`rainbow` is the one exception).
- No letters or text: the game bans them, and there is no text op anyway.
- Outline first, details last, so a streamed drawing reads well as it appears.

Files:

- `src/library/shapes.ts` - primitives (line, path, polygon, rect, ellipse,
  arc, zigzag, wave, star, heart, rounded rect, n-gon, bezier curves, dashed
  lines, spokes) and op transforms (translate, scale, mirrorX, rotate).
- `src/library/parts.ts` - composable parts: quadruped body, stick figure,
  smiley face, eye, wheel, flame, whiskers.
- `src/library/drawings.ts` - the base set, merged with `drawings-animals.ts`,
  `drawings-food.ts`, `drawings-people.ts`, `drawings-objects.ts` and
  `drawings-places.ts` into `DRAWINGS`.
- `src/library/generate.ts` - writes the JSON files and the contact sheets.
- `src/library/loader.ts` - `StrokeLibrary` (matches words after
  `normalizeGuess`, so `Ice Cream` and `ice cream` hit the same file).

### Regenerating

After editing any `drawings*.ts`:

```sh
pnpm -F @pictionary/bots build && pnpm -F @pictionary/bots gen:library
pnpm lint:fix                      # biome reformats the JSON
pnpm -F @pictionary/bots test
```

`gen:library` rewrites `library/*.json` and the contact sheets
`library/preview/contact-sheet-easy.png` and `contact-sheet-medium.png`
(256 px tiles, 8 per row, the word written under each tile by the generator;
labels exist only in the preview PNG, never in the ops). Options for
`node dist/library/generate.js`: `--png <dir>` (one PNG per word),
`--sheet <dir>`, `--pages` (also split each sheet into 40-tile pages, handy
for reviewing). Look at the sheets after every change: a drawing that is not
recognizable at 256 px is not recognizable to a guesser either.

## Tests

`pnpm -F @pictionary/bots test` runs the library tests (coverage, op limits,
bounds, color budget, chooser preference, PNG rendering of a sample). The
demo and race commands need a running server; see `docs/TESTING.md`.
