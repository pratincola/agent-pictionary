# Phase 1 decisions

Decisions Claude Code made while building P1 that PLAN.md / PROTOCOL.md did
not pin down, or where the build deviated. Each says why. Dates are 2026-11-02.

## Tooling

- **TypeScript 6.0.3, not 7.x.** TS 7 is the Go-based port; its `--build`
  behaviour and some flags differ. 6.0.3 is the last JS-based `tsc` and is
  stable with project references. Revisit in P4.
- **`typecheck` emits.** `tsc -b --noEmit` is rejected when a referenced
  project would need its declarations, so `pnpm typecheck` builds to `dist/`
  (gitignored) and then typechecks the test folders with a per-package
  `tsconfig.test.json`.
- **Workspace imports resolve to source via a custom export condition.**
  Each package exports `{ "source": "./src/index.ts", "import": "./dist/index.js" }`.
  `tsconfig.base.json` sets `customConditions: ["source"]` and vitest sets
  `resolve.conditions: ["source"]`, so tests and typecheck never need a prior
  build, while Node at runtime loads `dist/`.
- **`postgres` 3.4.9, not 4.0.0.** 4.0.0 was published four days before this
  work; Drizzle's `postgres-js` adapter is validated against 3.x.
- **Biome `preset: recommended`,** markdown excluded so the docs keep their
  hand layout.
- **Dev services as root.** The container runs as root; `initdb`/`postgres`
  refuse that, so `scripts/dev-services.sh` runs them via `runuser -u
  postgres` when `id -u` is 0, with `--auth=trust` on localhost. It also
  creates a superuser role named after the current OS user so a bare
  `postgres://localhost:5433/db` works.

## Protocol additions (PROTOCOL.md updated)

- **`ack`** server message. Messages with no natural reply (`room.ready`,
  `room.start`, `word.choose`, `word.custom`, `human.note`, `draw.ops`,
  `draw.erase`, `draw.clear`, `hello`) get `ack` with `replyTo`. For
  `draw.ops` the payload carries `{ opSeqFrom, opSeqTo }`, which lets a
  drawer confirm what landed without waiting for its own broadcast.
- **`room.state.you`** `{ sessionId, role, agentId?, humanId? }` so a client
  knows who the server thinks it is after reconnect.
- **`room.state.round.options`** for the drawer during `choosing`, so a
  drawer that reconnects can still pick.
- **`round.ended.roundScores`** (points awarded this round) next to the
  cumulative `scores`.
- **`OpLogEntry.erased`.** The op log is append-only; `draw.erase` and
  `draw.clear` flag entries instead of removing them. `opSeq` therefore stays
  contiguous, `GET /ops?after=` stays a pure delta, and viewers filter.
- **`match.ended.matchId`** and an optional `winnerAgentId` (absent when
  nobody scored).
- **`hello` is optional.** The token is in the URL, so the server sends
  `room.state` as soon as the socket is accepted. A `hello` with `v != 1` is
  rejected by the schema (`BAD_REQUEST`).
- **`error.replyTo` is absent for malformed JSON** (no id to echo).
- **REST** `POST /agents` also returns `humanId`; `POST /rooms/:code/sessions`
  returns `sessionId`; `GET /rooms/:code/ops` returns `roundIndex` (null in
  the lobby); `POST /admin/.../entitlements` accepts `grant` and `revoke`.
- **`maxPlayers` ceiling is 64** (default 8). PLAN.md §10 keeps 2–8 as the
  play range; the higher ceiling exists so the race test can put 51 agents
  in one room.

## Rules not pinned by PLAN.md §10

- **Auto-start.** The match starts when every connected player has sent
  `room.ready` and there are at least `minPlayers`. `room.start` by the
  creator forces a start with the connected players. Anonymous rooms accept
  `room.start` from any non-spectator.
- **Choosing timeout picks for the drawer** (seeded RNG) instead of skipping
  the round.
- **`wordLength`** counts letters only; `wordPattern` keeps spaces.
- **Drawer grace applies in `choosing` too**, not only `drawing`. A drawer who
  is already disconnected when their round begins gets the same grace.
- **Exhausted** means: every *connected* guesser team has spent its agent
  guesses and, if a human is connected for that team, its human guesses.
  Teams with no human attached do not block the round on unused human
  guesses.
- **`firstCorrectEnds=false`** (provisional): the first solver is the round
  winner and scores at round end; later solvers get `correct` and +5 (agent)
  or +3 (human) immediately; the round ends when all teams solved or spent
  their guesses, or on timeout.
- **Match winner** is the highest `points`; ties go to the earlier position
  in the drawer order; no winner when nobody scored.
- **Second socket for the same agent supersedes the first** (close code
  4001). Same session token reconnecting is the same session.
- **Late guesses** (after `round.ended`, during `reveal`) are recorded with
  `late`/`round_over` and persisted individually (`guess.append`), so the
  guesses table holds every correct guess and auditors can verify the winner
  has the minimum `seq`.
- **Custom words**: 1–3 words, letters only (any script), 2–20 letters each,
  small blocklist. Stored lowercased.
- **Human notes** require the drawer to hold `custom_word` (PLAN.md §6.7
  "paid"), are allowed only during `choosing`, and are delivered to the
  drawer agent's socket only.

## Server

- **API keys** are `"<agentId>.<secret>"`; only `scrypt(secret)` (N=16384,
  per-key salt) is stored. No external dependency.
- **Session tokens** are HMAC-SHA256 over base64url JSON claims
  `{ sid, code, role, agentId?, humanId?, exp }`, 24 h TTL, signed with
  `SESSION_SECRET`.
- **Entitlements** are loaded from the DB when the socket connects and pushed
  to live rooms through an `agent.entitlements` event when the admin route
  changes them. The engine owns the check.
- **Rate limit** for `draw.ops` is a per-session token bucket (burst 30,
  refill 30/s) in the transport layer, before the actor; the engine cannot
  do it because it has no clock. Over-limit messages get `RATE_LIMITED` and
  are dropped.
- **Idempotency** is a per-session LRU (256 entries) of client `id` -> the
  replies that carried `replyTo` = id. A duplicate replays them with the
  original `seq`; nothing is re-executed.
- **Persistence order.** `persist` effects are awaited inside the actor step,
  so the round row exists before the `round.ended` broadcast is sent. A failed
  write goes to the `outbox` table (payload = record + room id) and a retry
  loop applies outbox rows in id order every `outboxRetryMs`.
- **Schema additions** beyond PLAN.md §12: `rooms.seed` (replay), `rooms.
  creator_*`, `agents.pair_code`, `outbox.attempts/last_error`,
  `draw_ops.erased`, `rounds.reason`. `matches.id` is text
  (`<roomCode>-<n>`), everything else uuid.
- **Rooms live in memory** on one node (Phase 4 adds the Redis directory).
  A finished room with no connections is dropped after 60 s. Rooms do not
  survive a restart in P1; the DB keeps the record.
- **`/healthz`** returns 503 when the database does not answer.
- **`/rooms/:code/canvas.png`** returns 501 with a TODO.
- **Validate outgoing** is a config flag the tests turn on; every server
  message is schema-checked before send.
