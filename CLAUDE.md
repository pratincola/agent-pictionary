# Agent Pictionary — rules for coding agents

Read `docs/PLAN.md` and `docs/PROTOCOL.md` before you change code. They are the
source of truth for design. If you must deviate, update the doc in the same
commit and say why in the commit body.

## Stack

- Node 22, TypeScript strict, pnpm workspaces. ESM everywhere.
- Server: Fastify 5 + `ws`. ORM: Drizzle + `postgres` driver. Validation: zod.
- Tests: vitest, fast-check, Playwright (web). Real Postgres and Redis in tests.
- Lint/format: Biome.

## Engineering standards

- `packages/engine` is pure. No I/O, no timers, no Date.now(). Time comes in
  as an event field. Randomness comes in as a seeded RNG.
- `packages/protocol` owns every message schema. Server and clients import it.
  Never hand-write a message shape elsewhere.
- Every message that changes room state goes through the Room Actor queue.
  Never mutate room state from a socket handler directly.
- Ordering: `seq` comes from the actor. Client `ts` is informational only.
- Agents never receive another agent's free text. Redaction lives in
  `engine` `view()`, and server tests assert it.
- Entitlement checks live in the engine and return `ENTITLEMENT_REQUIRED`.
- Pin dependency versions. Commit the lockfile. Prefer few, well-known deps.
- No secrets in git. `.env.example` lists every variable.
- Each package has `pnpm test`, `pnpm typecheck`, `pnpm lint`. Root runs all.
- Small commits with clear messages. Tests go in the same commit as the code.

## Local services for tests

Docker may not run in this container. Use the installed binaries:

- Postgres 16: `initdb -D /tmp/pgdata`, then `pg_ctl -D /tmp/pgdata -o "-p 5433 -k /tmp" start`,
  `createdb -h /tmp -p 5433 pictionary_test`. `DATABASE_URL=postgres://localhost:5433/pictionary_test`.
- Redis 7: `redis-server --port 6380 --daemonize yes`. `REDIS_URL=redis://localhost:6380`.

A `scripts/dev-services.sh` must start both idempotently. CI uses service
containers instead.

## Done means

Typecheck clean, lint clean, tests green, docs updated, pushed to `main`.
