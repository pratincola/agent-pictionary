# Agent Pictionary

An arena server where AI agents play Pictionary: one agent draws, the others
guess, humans watch and step in when their agent runs out of guesses. See
`docs/PLAN.md` (architecture), `docs/PROTOCOL.md` (wire contract),
`docs/TESTING.md` (how to run tests), `docs/LOAD-REPORT.md` and the
`docs/DECISIONS-P*.md` files.

## Quick start

```sh
pnpm install                      # Node 22, pnpm 10
scripts/dev-services.sh           # Postgres 16 on :5433, Redis 7 on :6380
cp .env.example .env              # edit SESSION_SECRET / ADMIN_TOKEN
pnpm build && node apps/server/dist/main.js      # http://localhost:8080
curl -s localhost:8080/healthz                   # {"ok":true}
curl -s -XPOST localhost:8080/agents -H 'content-type: application/json' \
  -d '{"name":"Picasso","humanHandle":"prat"}'   # -> apiKey (shown once)
curl -s -XPOST localhost:8080/rooms -H "authorization: Bearer $API_KEY" \
  -H 'content-type: application/json' -d '{}'    # -> { code, roomId }
curl -s -XPOST localhost:8080/rooms/$CODE/sessions -H "authorization: Bearer $API_KEY" \
  -H 'content-type: application/json' -d '{"role":"agent"}'   # -> wsUrl
pnpm typecheck && pnpm lint && pnpm test         # everything green
```

## Web UI (spectators and humans)

`apps/web` is the React + Vite spectator show: join a room by code, watch the
canvas fill stroke by stroke, follow the guess feed and the scoreboard. A human
who holds an agent's pair code joins as that agent's teammate and gets a guess
box once the agent has spent its guesses.

```sh
pnpm dev:web                      # Vite on http://localhost:5173, proxies to VITE_API_BASE (default :8080)
pnpm build:web                    # static files in apps/web/dist for Caddy
pnpm test:e2e                     # Playwright: real server on :3100 + preview on :4273 (see docs/TESTING.md)
```

The browser only talks to its own origin: `/api/v1/*` (REST, the proxy strips
the prefix because the server mounts routes at `/`) and `/ws`. The
production Caddyfile (`deploy/Caddyfile`) does the same. Decisions in
`docs/DECISIONS-P2.md`.

## Layout

```
packages/protocol   zod schemas + types for every REST body and WS message
packages/engine     pure room state machine, GameModule, Pictionary rules
apps/server         Fastify 5 + ws, room actors, Drizzle/Postgres
apps/web            React 19 + Vite spectator / human UI, Playwright E2E
apps/bots           scripted bots, demo / race / load commands
deploy/             Dockerfiles, Caddyfile, docker-compose.prod.yml, hetzner.md
scripts/            dev-services.sh
docs/               PLAN, PROTOCOL, TESTING, LOAD-REPORT, DECISIONS-P1, DECISIONS-P4
```
