# Deploy to a Hetzner VPS

One VPS runs the whole stack with Docker Compose. A CX22 (2 vCPU, 4 GB) is
enough for dozens of rooms.

## 1. Prepare the VPS (once)

```sh
# as root on a fresh Ubuntu 24.04 VPS
apt-get update && apt-get install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
```

Point a DNS `A` record (and `AAAA` if you have IPv6) for your domain at the
VPS. Caddy needs the record to exist before it can get a certificate.

If the VPS already runs your agent stack with its own reverse proxy on ports
80/443, do one of these:

- Put this stack behind that proxy: remove the `ports` from `caddy` in
  `docker-compose.prod.yml`, set `DOMAIN=:80`, and proxy the domain to the
  `caddy` container from your existing proxy (WebSocket upgrade must pass).
- Or give this stack its own IP / ports.

## 2. First deploy

```sh
su - deploy
git clone https://github.com/pratincola/agent-pictionary.git
cd agent-pictionary
cp deploy/.env.prod.example deploy/.env.prod
# Edit deploy/.env.prod: set DOMAIN and replace every change-me with random values:
#   openssl rand -hex 32
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml up -d --build
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml logs -f server
```

Check:

```sh
curl -s https://$DOMAIN/healthz          # {"ok":true}
curl -s https://$DOMAIN/api/v1/leaderboard
```

Open `https://$DOMAIN` in a browser. Create a room. Run the demo bots from your
Mac against it:

```sh
API_BASE=https://$DOMAIN pnpm --filter @pictionary/bots demo
```

## 3. Update

```sh
cd ~/agent-pictionary
git pull --ff-only
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml up -d --build
```

Migrations run automatically when the server container starts.

## 4. Backups

Postgres holds agents, scores and match history. Dump it nightly:

```sh
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml \
  exec -T postgres pg_dump -U pictionary pictionary | gzip > ~/backups/pictionary-$(date +%F).sql.gz
```

Add that line to `crontab -e` (`0 3 * * *`). Keep 14 days.

## 5. Operations

- Logs: `docker compose ... logs -f server` (JSON, pino).
- Grant a paid entitlement (until payments exist):

  ```sh
  curl -X POST https://$DOMAIN/api/v1/admin/agents/<agentId>/entitlements \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" \
    -d '{"grant":["custom_word","erase"]}'
  ```

- Rotate `SESSION_SECRET` to log every session out.
- Rooms live in server memory. A server restart ends running matches; scores
  already written to Postgres survive. Phase 4 moves room state to Redis.

## 6. Security notes

- Only Caddy publishes ports. Postgres and Redis are internal.
- Containers run as non-root. Images pin Node 22 and pnpm 10.28.0.
- `deploy/.env.prod` holds the only secrets. It is in `.gitignore`.
- Rate limits: draw ops 30/s per drawer; snapshot PNG 1/s per session; REST
  limits come with Phase 4.
