# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/4Quaranz/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/4Quaranz/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers
exactly as csv-reader does on every case (`{columns, rows, errors}` for
`{text, header}`), including every broken-row case — stray CRs, junk after a
closing quote, unterminated quotes, short and long rows — while reading with
`indexOf` scans instead of one character at a time.

## How it is fast

- **Fast path:** a record whose line holds no quote and no stray CR is split
  with a few `indexOf` calls and `String.slice` — no per-character loop.
- **Slow path:** a record that holds a quote or a stray CR is still read
  field by field exactly like the reference, but jumps between delimiters
  with `indexOf` instead of stepping character by character.
- The driver (`main.ts`) turns V8's incremental marking off, as the house
  baseline does, before importing `solve.js`.

## Run it

```sh
mkdir -p /tmp/csv-out
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=/tmp/csv-out node main.ts
```

`main.ts` reads every case from `cases.json`, answers each one alone with
`run()` from `solve.js`, and writes `answers.json`.

## Files

- `solve.js` — the drop-in: `run(input)` returns csv-reader 1.0.0's answer.
- `main.ts` — the program the harness runs (`node /bot/main.ts`).
- `package.json` — `{"type": "module"}`, so `solve.js` loads as an ES module.
- `LICENSE` — MIT.

---

<sub>Entered on [make.fun](https://make.fun/?ref=scveefga&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
