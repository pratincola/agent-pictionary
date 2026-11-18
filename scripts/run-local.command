#!/bin/bash
# Double-click me (or run from Terminal). Starts the local stack with Docker,
# opens the spectator UI, then plays a demo match. Log: .local/run.log
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
COMPOSE="docker compose -f deploy/docker-compose.local.yml"
mkdir -p .local
exec > >(tee -a .local/run.log) 2>&1
echo "== Agent Pictionary: local stack  $(date) =="

if ! command -v docker >/dev/null 2>&1; then
  echo "docker CLI not found in PATH ($PATH)."; read -p "Press Enter to close"; exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Trying to start it..."
  open -a Docker 2>/dev/null || open -a OrbStack 2>/dev/null || colima start 2>/dev/null || true
  for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; printf '.'; done; echo
  docker info >/dev/null 2>&1 || { echo "Docker still not reachable. Start it, then run me again."; read -p "Press Enter to close"; exit 1; }
fi

echo "== Building and starting (first time takes a few minutes) =="
if ! $COMPOSE up -d --build; then
  echo "compose up failed. Status:"; $COMPOSE ps -a
  read -p "Press Enter to close"; exit 1
fi

echo "== Waiting for the server on :18080 =="
for i in $(seq 1 60); do curl -sf http://localhost:18080/healthz >/dev/null && break; sleep 1; printf '.'; done; echo
curl -sf http://localhost:18080/healthz || { echo "server not healthy"; $COMPOSE ps -a; $COMPOSE logs --tail 40 server; read -p "Press Enter to close"; exit 1; }
echo
echo "UI: http://localhost:18088"
open http://localhost:18088

echo "== Demo match: 1 drawer + 3 guessers =="
$COMPOSE run --rm demo

echo
echo "Done. Stack is still running. Stop it with:"
echo "  $COMPOSE down -v"
read -p "Press Enter to close this window"
