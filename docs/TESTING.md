# Testing

Analogy from PLAN.md §14: test the referee alone (engine), then the stadium
with real crowds (integration), then a stampede (race/load).

## Prerequisites

- Node 22, pnpm 10 (`corepack enable` or `npm i -g pnpm@10`).
- Postgres 16 and Redis 7 binaries on the machine (Docker is optional).

```sh
pnpm install
scripts/dev-services.sh          # idempotent: Postgres on 5433, Redis on 6380
scripts/dev-services.sh status   # or: stop
```

The script runs `initdb`/`pg_ctl` as the `postgres` OS user when invoked as
root, creates the `pictionary_test` database, and prints the two URLs.
The SDK and MCP suites use their own databases next to it:
`createdb -h /tmp -p 5433 pictionary_agents` and
`createdb -h /tmp -p 5433 pictionary_mcp` (once).

```
DATABASE_URL=postgres://postgres@localhost:5433/pictionary_test
REDIS_URL=redis://localhost:6380
```

Redis is started for parity with Phase 4; Phase 1 tests do not use it.

## One command

```sh
pnpm typecheck && pnpm lint && pnpm test
```

`pnpm test` runs every package in turn (`--workspace-concurrency=1`) because
the server tests share one Postgres. Run `pnpm typecheck` (or `pnpm build`)
first in a fresh checkout: workspace packages are externalized by vitest and
load from `dist/`. Expect about two minutes; the stroke
integrity test alone runs ~70 s because it sends 2,000 ops at the real 30
ops/s limit.

## Test classes

| Class | Where | Command | What it proves |
|-------|-------|---------|----------------|
| Protocol unit | `packages/protocol/test` | `pnpm -F @pictionary/protocol test` | Normalization edge cases (NFKC, punctuation, leading articles, Levenshtein), DrawOp bounds, no text op, message schemas. |
| Engine unit | `packages/engine/test/pictionary.test.ts` | `pnpm -F @pictionary/engine test` | Lobby, full two-round match, guess limits, human gating, entitlements, custom words, human.note routing, disconnect grace, reconnect. |
| Engine property | `packages/engine/test/properties.test.ts` | same | fast-check: lowest `seq` wins for any arrival order; replaying the event log gives a deep-equal state and identical effects; redaction invariants. |
| Integration | `apps/server/test/integration.test.ts` | `pnpm -F @pictionary/server test` | REST surface; 3 agents + paired human + spectator play all rounds over real sockets; rounds/guesses/draw_ops/scores/agent_stats rows equal the broadcasts. |
| Race | `apps/server/test/race.test.ts` | `cd apps/server && pnpm exec vitest run test/race.test.ts` | 50 guessers fire the correct word in one tick, 20 runs (odd runs with 0–3 ms jitter) plus an interleaved wrong/right variant. Exactly one winner, byte-identical `round.ended` on 51 sockets, DB `winning_seq` = min seq among correct guesses, `recv_ns` monotone in `seq`. |
| Stroke integrity | `apps/server/test/strokes.test.ts` | `cd apps/server && pnpm exec vitest run test/strokes.test.ts` | 2,000 ops at 30 ops/s; every client sees contiguous `opSeq` 1..2000; a client that drops mid-stream reconnects with its token, fills the gap via `GET /rooms/:code/ops?after=`, and ends with the same log. Also the `RATE_LIMITED` burst case. |
| MCP | `apps/mcp/test/mcp.test.ts` | `pnpm -F @pictionary/mcp test` | Official MCP `Client` over `InMemoryTransport` against the real server (db `pictionary_mcp`, port 3300): tool listing, idempotent `register_agent` + 0600 identity file, two MCP sessions play a two-round match (choose, paced draw, PNG render, guesser sees pattern not word, guesses, `NOT_DRAWER` / `ENTITLEMENT_REQUIRED` as `isError`), `wait_for_event` timeout. |
| Chaos | `apps/server/test/chaos.test.ts` | `cd apps/server && pnpm exec vitest run test/chaos.test.ts` | Duplicate `guess.submit` id is idempotent; malformed JSON / schema violations / binary frames -> `BAD_REQUEST`, socket stays open; free agent `draw.erase` -> `ENTITLEMENT_REQUIRED`, admin grant unlocks live; drawer disconnect -> `drawer_left` after grace; drawer reconnect keeps the round; superseded sockets; ROOM_FULL / WRONG_PHASE at session creation; injected DB failure -> broadcast still happens, outbox row, retry lands the round. |

Server tests set `validateOutgoing: true`, so every message the server emits
is parsed against the protocol schema before it leaves the process. A schema
violation fails the test instead of reaching a client.

## Running a single file or test

```sh
cd apps/server
pnpm exec vitest run test/chaos.test.ts
pnpm exec vitest run test/race.test.ts -t "run 7/"
TEST_LOG_LEVEL=info pnpm exec vitest run test/integration.test.ts   # see pino output
```

`DATABASE_URL` overrides the database for server tests. Each server test file
truncates every table at start (`resetDb`), so do not point it at real data.

## Typecheck and lint

- `pnpm typecheck` builds every package with `tsc -b` (project references;
  `--noEmit` is not allowed with references) and then typechecks the test
  folders with each package's `tsconfig.test.json`.
- `pnpm lint` runs Biome; `pnpm lint:fix` formats. Markdown is excluded.

## CI (to add in Phase 4)

GitHub Actions with Postgres and Redis service containers:
`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
The race and stroke tests are deterministic enough to run on every PR; keep
them in the required set.
