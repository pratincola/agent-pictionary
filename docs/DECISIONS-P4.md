# Phase 4 decisions

Decisions Claude Code made while building P4 (scale, reliability, CI) that
PLAN.md did not pin down, or where the build deviated. Each says why. Dates
are 2026-11-10. Branch `phase4-scale`.

## Dependencies (all pinned exactly)

- **ioredis 6.0.0** (`apps/server`). Released 2026-07-31; the API the server
  uses (`set NX PX`, `eval`, `pipeline`, `subscribe`/`on("message")`,
  `hset`/`hgetall`, `sadd`/`smembers`) is unchanged from 5.x and was
  smoke-tested against Redis 7 before use. One connection for commands, one
  for subscriptions (Redis requires a dedicated subscriber connection).
- **prom-client 15.1.3** (`apps/server`). npm marks it deprecated in favour
  of `@prometheus-io/client` (0.16.x, first published 2026-08-21 under the
  prometheus org). The task asked for prom-client, it is the well-known
  library, and the successor is under three months old with a 0.x version;
  switching is a small follow-up once it reaches 1.0. One `Registry` per
  server instance so several in-process servers (tests) do not share
  counters.
- **@fastify/rate-limit 11.2.2** (`apps/server`), registered with
  `global: false` and per-route `config.rateLimit`, Redis store when
  `REDIS_URL` is set (shared counters across nodes), in-memory otherwise.
- **ws 8.22.1** added to `apps/bots` for the load generator (the SDK uses it
  already; the load client bypasses the SDK's per-message validation to
  measure the transport, not zod).

## Multi-node

- **`REDIS_URL` unset means single node, in-memory.** The Phase 1 config
  defaulted `REDIS_URL` to localhost; it is now optional so the existing
  test suite and a plain `node dist/main.js` keep the Phase 1 behaviour.
  `NODE_ID` defaults to `node-<pid>`; set it explicitly on any deployment
  that wants restart recovery (the compose file sets `node-1`).
- **Directory keys.** `room:{code}` -> nodeId (`SET NX PX ttl`),
  `node:{id}` hash `{restBase, wsBase}`, `node:{id}:rooms` set (what to
  restore). Heartbeat every `ROOM_TTL_MS / 3` runs a Lua script per owned
  room that renews the entry if it is ours and **re-creates it if it
  expired and nobody else took it** (Redis blip, paused process). A node
  that stays silent for `ROOM_TTL_MS` (default 15 s) disappears from the
  directory; other nodes then answer 404 for its rooms rather than
  redirecting to a dead node.
- **Players redirect, spectators relay.** `POST /rooms/:code/sessions` with
  role `agent` or `human`, `GET /rooms/:code`, `/ops` and `canvas.png` on a
  non-owner answer `307` with `Location: <owner PUBLIC_REST_URL><same
  path>`. Note that `fetch` drops `Authorization` on a cross-origin
  redirect, so an agent client must re-send the request with its key to the
  new origin; the SDK does not do this yet (follow-up, only matters with
  more than one public origin). Role `spectator` is served locally: a
  `RemoteRoom` relay subscribes to `room:{code}:events`, fetches one
  spectator-redacted snapshot from the owner over `GET
  /rooms/:code/snapshot` (public information; spectators get the same via
  `room.state`), sends `room.state` with its own `you`, then forwards the
  owner's broadcast JSON unchanged, dropping buffered messages whose `seq`
  is already in the snapshot. Relay spectators can `ping` (answered
  locally with the last relayed `seq`); any other message gets
  `NOT_IN_ROOM`. The relay drops itself when its last socket leaves or when
  the owner publishes `{"type":"room.closed"}` on `room:{code}:control`.
- **Only the spectator-visible subset leaves the node.** The actor
  publishes a broadcast on the bus only when its audience includes
  spectators, so the bus never carries drawer-only or agent-only
  messages, and the PLAN.md §11 redaction holds across nodes by
  construction (relays serve spectators only).
- **Agent tokens on the wrong node are refused** (upgrade answered 409),
  even though the shared `SESSION_SECRET` would verify them. The single
  writer stays single: no code path on a non-owner enqueues into a room.
- **`PUBLIC_REST_URL`** is new: the base other nodes redirect to. Default:
  `PUBLIC_WS_URL` with `ws` -> `http`, else the listen address. Behind
  Caddy it must include the mount (`https://DOMAIN/api/v1`); the compose
  file sets it. `trustProxy` is on so rate limits see the client IP.

## Snapshots and restart recovery

- **When.** After `room.playerJoined`, `room.playerLeft`, `match.started`,
  `round.ended`, `match.ended` broadcasts, at room creation, and at
  graceful shutdown. The snapshot is the whole engine `RoomState` (plain
  data, `rng` is a number) plus the pending `schedule` timers (`timerId`,
  `at`) and the `roomId`. `room:{code}:snapshot`, 24 h TTL.
- **Restore.** On `listen()`, a node reads `node:{id}:rooms`, loads each
  snapshot, skips (and cleans up) finished rooms, re-claims the directory
  entry, builds the actor from the state, re-arms the timers (one already
  due fires at once) and enqueues `session.leave` for every session the
  snapshot had connected, so the engine sees the sockets go (drawer grace
  and the lobby `connected` flags behave as after a real disconnect).
  Session tokens are HMAC over the shared secret with a 24 h `exp`, so
  clients reconnect with the token they hold; `you.sessionId` is the same.
- **Mid-round is out of scope, by design.** A snapshot is never taken
  during `drawing`; strokes and guesses since the last snapshot are gone
  after a restart. The round-end snapshot keeps the match, the scores and
  the `reveal` timer, so a restored room continues with the next round's
  `choosing`. Snapshotting every draw op would cost one Redis write per
  stroke for a case (process death mid-round) that Postgres already records
  at round end; revisit only if restarts mid-round turn out to matter.
- **Shutdown vs. close.** `RoomManager.remove` (finished room, idle 60 s)
  deletes the snapshot and the directory entry and tells relays. `closeAll`
  (SIGTERM) keeps the snapshot and the restore-set membership, **unpins**
  the directory entry (so other nodes answer 404 instead of redirecting to a
  dead node) and lets the same `NODE_ID` re-claim on restart.
- **Graceful close drains.** `RoomActor.close` now stops accepting, waits
  for the queue to empty (every accepted event is processed and persisted),
  then clears timers and closes sockets with 1001. Phase 1 dropped queued
  events on close.

## Metrics

- Names are prefixed `ap_`. `ap_broadcast_latency_seconds` is observed once
  per broadcast effect of a client-originated step, from the socket's
  `recvNs` (stamped before JSON parse) to the end of the fan-out loop. It
  therefore includes any `persist` effect that ran earlier in the same step
  (PLAN.md §9.5 writes before broadcasting), which is why `room.ready` ->
  `match.started` and `round.ended` show up in the 100-250 ms bucket while
  draw ops sit under 1 ms. That is the honest number for "when did everyone
  hear it".
- `ap_actor_queue_depth` is collected on scrape (sum over local actors).
- `ap_sessions_connected{role}` counts relay spectators too.

## Rate limits

- Defaults: `POST /agents` 60/min/IP, `POST /rooms` 30/min/IP,
  `GET /rooms/:code/canvas.png` 1/s per session (key: `token` query, else
  bearer, else IP). Env `RATE_LIMIT_*`. Server tests raise them to 100,000
  (`test/helpers.ts`) because the race test alone registers 51 agents per
  run from one IP; one test pins small limits and asserts the 429s and the
  `ap_rest_rate_limited_total` counter. The load generator raises them on
  the server it spawns.
- `canvas.png` still answers 501 (server-side rendering was moved to the
  SDK's local renderer in P3); the limiter is in place for when it returns.

## Load test

- Lives in `apps/bots` (`load` command, root `pnpm load`) rather than
  `apps/server/test/load`, because it needs worker threads from built JS
  and the bots package already builds to `dist/`. `apps/bots` joined
  `tsconfig.build.json` so the root build produces it. Excluded from
  `pnpm test`; see `docs/LOAD-REPORT.md` for the numbers (p95 1.8 ms, far
  under the 50 ms target), method and the two optimisations that were not
  needed.
- Guessers send two wrong guesses each (not three) so the round cannot end
  `exhausted` before the drawer finishes; three wrong guesses from every
  guesser is a legitimate round end, not a bug.

## CI and deploy

- `ci.yml` publishes the service containers on 5433/6380 to match
  `scripts/dev-services.sh`, so no test needs CI-specific URLs. `REDIS_URL`
  is deliberately not exported job-wide: the multi-node test pins its own
  logical DB, and any server a test builds without an explicit `redisUrl`
  would otherwise read the variable.
- The `docker` job builds both images without pushing. The development
  container has no Docker daemon, so both Dockerfiles were instead dry-run
  step by step here (filtered `pnpm install --frozen-lockfile` with only
  `packages/` and one app copied, build, `--prod` prune, module load; Vite
  build). pnpm accepts a lockfile whose importers include workspace
  packages that are absent from the context, so no change to the COPY or
  `--filter` lines was needed. Added: `.dockerignore` (local `docker
  compose build` would have copied `node_modules` and `dist`),
  `HEALTHCHECK` on `/readyz`, `deploy/.env.prod.example` (the runbook
  referenced a file that did not exist; `.gitignore` now exempts it).
- **Caddyfile** proxied `/api/*` without stripping the prefix while the
  server mounts REST at `/`; production would have 404ed. Now
  `handle_path /api/v1/* { reverse_proxy server:8080 }`, the same rewrite
  the Vite proxy does. `/ws` matches the path of
  `<PUBLIC_WS_URL>/ws?token=...` (`PUBLIC_WS_URL=wss://DOMAIN` in compose,
  `wsUrl` is built as `${PUBLIC_WS_URL}/ws?token=`, the UI opens
  `wss://<page host>/ws?token=`). `/healthz` and `/readyz` are proxied;
  `/metrics` is not.
- GHCR push and the deploy to a URL remain open (PLAN.md §16 question 1,
  the domain). The compose file builds images locally; `IMAGE_PREFIX` /
  `IMAGE_TAG` are ready for a registry.

## Known gaps / follow-ups

- SDK: follow a 307 from `POST /rooms/:code/sessions` by re-sending with
  the API key (only needed with several public origins).
- Unfinished rooms with no sockets live until the node restarts (Phase 1
  behaviour; only finished rooms are dropped after 60 s idle). Add a lobby
  idle timeout.
- `prom-client` -> `@prometheus-io/client` once that reaches 1.0.
- `apps/mcp` on this branch has no tests yet (built in parallel on another
  branch), so `pnpm -r test` fails there until the branches merge; every
  other package is green (155 tests).
