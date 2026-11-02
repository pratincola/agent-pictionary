# Agent Pictionary — Architecture and Build Plan

Status: v0.1 (2026-11-01). Owner: Prat. Author: Claude (plan) + Claude Code (execution).

## 0. The glimmer

A Pictionary that agents play. One agent draws. The other agents guess. Humans
watch their agents work, and step in with a guess when their agent runs out.

## 1. Thirty years out (no filter)

Agents are entertainers and competitors, not only tools. People watch agent
leagues the way they watch e-sports today. Any agent can walk into an "arena"
with a room code and play, because arenas speak one open protocol. A human and
their agent form a team; the human coaches, the agent performs. Arenas sell
small capabilities to agents (a better pen, a custom word) the way games sell
cosmetics today. Games are how agents show character, not only skill.

## 2. Signals in the present

- Agent-vs-agent game benchmarks exist (chess, poker, Pokémon streams,
  Kaggle Game Arena).
- MCP gives agents one plug for many tools; an arena can be one more tool.
- Humans already watch coding agents work in real time and enjoy it.
- LLM inference cost falls each year; a round of guesses costs cents.

## 3. Direction vs. details

- **Direction we commit to:** a game-agnostic *arena server* (rooms, identity,
  sessions, scores, fair ordering, live spectating). Pictionary is the first
  `GameModule`, not the product.
- **Details we hold loosely:** scoring rules, round timing, payment vendor,
  UI style, which LLMs play.

## 4. One step this quarter

Ship an MVP arena with one game (Pictionary) that real agents (Claude Code,
Hermes) can join through MCP, and that gets the winner right under a race.
This step only makes sense if agents will play many games with humans watching.

## 5. Pressure test (honest pushback)

- **Strongest objection:** agent play may be boring to watch. Raw LLM strokes
  are slow and crude. Mitigation: stream every stroke, show guesses live, keep
  rounds short, add personality later (agent "voice" lines in the feed).
- **Cheating by letters:** a drawer can draw the word as text. MVP bans text
  ops and logs everything. Phase 5 adds a VLM referee that flags letters.
- **Cost:** an LLM guesser that re-reads the canvas every second burns money.
  The protocol sends a PNG snapshot on request, not on every stroke, and
  the SDK rate-limits snapshot calls.
- **What would prove the direction wrong:** nobody wants to watch a second
  game, or agents cannot draw well enough to make guessing possible.

## 6. Requirements (from Prat, 2026-11-01)

Functional:

1. Rooms. Anyone joins with a code. Many rooms at once. A room hosts one game.
2. Pictionary. One drawer agent, N guesser agents. Agents get 3 guesses each.
   After 3 misses, the agent's human can submit extra guesses.
3. Agents must not communicate with each other. The server never relays
   agent text to another agent. Agents do not see other agents' guesses.
4. Server tracks agents, sessions, and scores per agent.
5. Exact winner ordering. Many agents can answer in the same millisecond.
   The server must name one winner, deterministically.
6. Spectators see the drawing stroke by stroke, and every guess, in real time.
7. Word choice: drawer picks from the pool, or (paid) brings a custom word.
   The human may help the drawer agent with ideas (paid).
8. Erase while drawing is paid.
9. Payments come after MVP. The entitlement model exists from day one.

Non-functional: scalable (many rooms, many spectators), reliable (no lost
strokes, reconnect works), testable (race and load tests in CI), self-hosted
on Hetzner with Docker Compose.

## 7. Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | Node 22 + TypeScript, pnpm monorepo | One language for server, UI, SDK, MCP, bots. |
| D2 | Fastify + `ws` for WebSocket | Fast, small, mature. |
| D3 | Postgres (Drizzle ORM) for durable data; Redis for pub/sub, room directory, rate limits | Standard, both already on the VPS. |
| D4 | **One actor per room, single writer** | Order of arrival at the actor is the order. See §9. |
| D5 | Drawing is a log of vector ops with a server sequence number | Small, replayable, lossless, renders to PNG for VLMs. |
| D6 | Role-based view redaction in the engine | Enforces "agents do not talk" in one place. |
| D7 | `GameModule` interface from day one | Room hosts "one of the games". Pictionary is module #1. |
| D8 | Entitlements (`custom_word`, `erase`) checked in the engine; granted by admin in MVP, by Stripe in Phase 5 | Payment is a later phase, not a rewrite. |
| D9 | Round ends on the first correct guess (config `firstCorrectEnds=true`) | The race is the fun. Skribbl-style "everyone guesses" is a config flag for later. |
| D10 | Vitest + fast-check + Playwright; real Postgres/Redis in tests, no mocks for the data layer | Race and ordering bugs hide behind mocks. |
| D11 | Docker Compose + Caddy (auto TLS) on Hetzner | Same compose file on Mac and VPS. |

## 8. Components

```
agent-pictionary/
  apps/
    server/      Fastify + ws. REST + WebSocket. Hosts room actors.
    web/         React + Vite spectator and human-counterpart UI.
    mcp/         MCP server: join_room, get_state, draw, guess, ... (wraps sdk)
    bots/        Scripted drawer/guesser bots; LLM bot via OpenRouter (Phase 3)
  packages/
    protocol/    zod schemas + TS types for every message and REST body. Single source of truth.
    engine/      Pure, deterministic: Room state machine + GameModule + Pictionary. No I/O.
    sdk/         TS client for agents: connect, join, draw, guess, events, snapshot().
  deploy/        docker-compose.yml, docker-compose.prod.yml, Caddyfile, hetzner.md
  docs/          PLAN.md, PROTOCOL.md, TESTING.md
```

Analogy: `engine` is the rulebook and the referee's brain. `server` is the
stadium: doors, seats, loudspeakers. `protocol` is the language everyone in
the stadium speaks. `sdk`/`mcp` are the players' earpieces.

## 9. Fair ordering — the core correctness property

Problem: 50 agents send the correct word at the "same time". Clocks on the
agents are not trusted. Network paths differ. We still must pick one winner,
and every client and the database must agree on that winner.

Design (one toll booth, one lane):

1. Each room has one **Room Actor**: an in-memory async queue in exactly one
   server process. All inbound events for the room go through this queue.
2. The socket `message` handler stamps `recvNs = process.hrtime.bigint()`
   **before** JSON parsing, then enqueues. The actor assigns a per-room
   monotonically increasing `seq` as it dequeues. `seq` is the truth.
3. The engine is a pure function `(state, event) -> (state, effects)`.
   Replaying the event log from `seq=1` rebuilds the same state. This makes
   the winner reproducible in tests and audits.
4. First `guess.submit` whose normalized text matches wins. The actor marks
   the round `ended` in the same step. Later correct guesses in the queue get
   `result: "late"`. Nobody else can win.
5. Persistence: the actor writes `round_result` (winner, winning seq, recvNs)
   and the full guess log to Postgres before it broadcasts `round.ended`.
   If the write fails, the broadcast still carries the in-memory result and a
   retry writes the record (append-only outbox table).
6. Multi-node (Phase 4): rooms are pinned to one node via a Redis directory
   `room:{code} -> nodeId` (SET NX, TTL heartbeat). A client that lands on the
   wrong node gets a `307` to the right node. Spectators may attach to any
   node; room events fan out over Redis pub/sub (read-only). The single
   writer stays single.

Tie-breaking does not exist by design: two events never share a `seq`.

Client-sent timestamps are stored for display and latency stats only. They
never affect ordering.

## 10. Pictionary rules (MVP)

- Players: 2–8 agents per room. Min 2 to start (1 drawer + 1 guesser).
  (`maxPlayers` default 8; the schema ceiling is 64 so race/load tests can
  fill a room with 51 agents.)
- Match: `roundsPerPlayer` × players rounds. Drawer rotates round-robin.
- Round phases: `choosing` (20 s) → `drawing` (90 s) → `reveal` (5 s).
- Choosing: server offers 3 words (easy/medium/hard). Drawer picks one.
  Paid drawer may send `word.custom` (1–3 words, letters/spaces only,
  not in blocklist). Human of a paid drawer may send `human.note` to their
  own agent during `choosing` only. The server relays it to that agent and
  nobody else.
- Drawing ops: `path`, `line`, `rect`, `ellipse`. No text op exists. Canvas is
  a 1000×1000 logical space. Server validates bounds, caps 30 ops/s and 500
  points per path, assigns `opSeq`, appends to the round op log, broadcasts.
- Erase (paid): `draw.erase { opSeq }` removes one op, or `draw.clear` removes
  all. Both need the `erase` entitlement. Both are broadcast so viewers stay
  in sync.
- Guessing: each guesser agent has 3 guesses. Normalization: lowercase, trim,
  strip punctuation, collapse spaces, strip leading "a/an/the". Match = equal
  to the word or an accepted alias. `close` = Levenshtein ≤ 1 (feedback only
  to that guesser). After 3 misses the agent's paired human has
  `humanGuessesPerRound` (default 3). Drawer and drawer's human cannot guess.
- Scoring (team = agent + its human): first correct guesser +10 plus
  `ceil(secondsLeft / 10)` bonus. Human-assist correct: +5 to the team,
  recorded as `source: human`. Drawer +5 when someone guesses the word.
  Nobody guesses → drawer 0, no winner.
- Round ends on first correct guess, or timer, or when every guess is spent.
  Choosing timeout: the server picks one of the three options for the drawer.
- Disconnects: drawer gone > 10 s in `drawing` → round skipped, no points.
  Guesser reconnects with its session token and keeps remaining guesses.

## 11. Anti-collusion rules (enforced by view redaction)

| Viewer | Sees word | Sees own guess results | Sees others' guess text | Sees strokes |
|--------|-----------|------------------------|-------------------------|--------------|
| Drawer agent | yes | n/a | no (only count of wrong guesses) | yes |
| Guesser agent | no (until reveal) | yes | **no** | yes |
| Human (any) | no (until reveal) | their team's | yes (live feed) | yes |
| Spectator | no (until reveal) | n/a | yes (live feed) | yes |

Agents never receive another agent's free text. Humans see everything
because the show is for them.

## 12. Data model (Postgres)

- `humans(id, handle, created_at)`
- `agents(id, human_id, name, api_key_hash, tier, entitlements text[], pair_code, created_at, last_seen_at)`
- `rooms(id, code unique, game_id, config jsonb, status, seed, creator_agent_id null, creator_human_id null, created_at, closed_at)`
- `sessions(id, room_id, agent_id null, human_id null, role, connected_at, disconnected_at, reconnects int)`
- `matches(id, room_id, started_at, ended_at)`
- `rounds(id, match_id, index, drawer_agent_id, word, word_source, started_at, ended_at, reason, winner_agent_id null, winner_source, winning_seq, winning_recv_ns)`
- `guesses(id, round_id, seq, agent_id, human_id null, source, text, normalized, result, recv_ns, client_ts)`
- `draw_ops(round_id, op_seq, op jsonb, erased bool)`
- `scores(match_id, agent_id, points, agent_points, human_points)`
- `agent_stats(agent_id, matches, rounds_drawn, wins, points)` — leaderboard
- `outbox(id, kind, payload jsonb, created_at, sent_at null, attempts, last_error)` — retry writes
- `entitlement_grants(id, agent_id, entitlement, source, granted_at, expires_at)`

Redis (Phase 4): `room:{code}` → nodeId; `node:{id}` heartbeat; pub/sub
channel `room:{code}:events`; rate-limit keys.

## 13. Hosting — Hetzner VPS

- Compose services: `caddy` (TLS, static `web`, reverse proxy `/api` and
  `/ws`), `server`, `postgres`, `redis`. One CX22-class VPS is enough for
  dozens of rooms.
- Images built by GitHub Actions and pushed to GHCR. Deploy = `docker compose
  pull && docker compose up -d` over SSH. Runbook in `deploy/hetzner.md`.
- Secrets in `.env` on the VPS only. Never in git.
- Security posture (per Prat's supply-chain stance): lockfile committed,
  versions pinned, `pnpm audit` in CI, Dependabot, minimal deps, non-root
  containers, rate limits on REST and WS, CORS allowlist, API keys hashed.
- Observability: pino JSON logs, `/healthz`, `/metrics` (prom-client) in
  Phase 4.

## 14. Testing strategy

Analogy: test the referee alone (engine), then the stadium with real crowds
(integration), then a stampede (race/load).

1. **Engine unit tests** (vitest). Pure state machine. Property tests with
   fast-check: for any order of N correct guesses, the winner is the one with
   the lowest `seq`; replaying the event log yields identical state.
2. **Integration tests**. Real server in-process, real Postgres and Redis.
   N `ws` clients run a full match. Assert DB rows match broadcasts.
3. **Race test** (the key test). 50 guesser clients hold open sockets, then
   fire the correct word in one tick. Assert: exactly one `winner`; every
   client got the same `round.ended`; `winningSeq` is the lowest seq among
   correct guesses; the `rounds` row agrees; the other 49 got `late` or
   `round_over`. Repeat 20× with random jitter.
4. **Stroke integrity**. Drawer bot sends 2,000 ops at 30 ops/s. Every client
   sees contiguous `opSeq` 1..2000. Reconnect mid-stream; snapshot + delta
   fills the gap.
5. **Load** (Phase 4). 20 rooms × 8 agents + 50 spectators/room. Measure
   p95 op broadcast latency (recvNs → client receipt) and CPU. Target p95 <
   50 ms on one VPS core.
6. **Chaos**. Drawer disconnect, duplicate `guess.submit` with the same `id`
   (idempotent), malformed JSON (rejected by zod, socket stays up), paid op
   from a free agent (`ENTITLEMENT_REQUIRED`).
7. **UI E2E** (Playwright). Spectator page shows live strokes and guess feed
   during a bot match; human extra-guess works after 3 agent misses.
8. **CI**: GitHub Actions: lint, typecheck, unit, integration with service
   containers, Playwright on PRs.

## 15. Phases

| Phase | Scope | Done when |
|-------|-------|-----------|
| P0 | This plan + protocol | Docs merged |
| P1 | Monorepo, `protocol`, `engine` (Room + Pictionary), `server` (REST + WS, actors, Postgres), unit + integration + race tests | Race test passes 20/20; full match runs with ws clients. **Done 2026-11-02**, see `docs/DECISIONS-P1.md`, `docs/TESTING.md`. |
| P2 | `web` spectator UI: join by code, live canvas, guess feed, scoreboard, human pairing + extra guess | Playwright E2E green |
| P3 | `sdk`, scripted bots (drawer from stroke library, guessers with jitter), `mcp` server, LLM bot via OpenRouter | Claude Code joins a room through MCP and plays a round |
| P4 | Redis directory + pub/sub, multi-node, load tests, metrics, Compose prod, Caddy, GHCR, Hetzner runbook | Deployed at a URL; load test report |
| P5 | Stripe entitlements, VLM referee for letters, second game module, agent personality lines | — |

## 16. Open questions for Prat

1. Domain name for the VPS deployment?
2. Should spectators be able to vote/react (emoji) in MVP, or later?
3. LLM for the first real bot: Gemini Flash via OpenRouter (cheap) or Claude?
