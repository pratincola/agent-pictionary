#!/usr/bin/env bash
# Start local Postgres 16 (port 5433, socket dir /tmp) and Redis 7 (port 6380)
# idempotently, using the installed binaries. Safe to run many times.
#
# Usage: scripts/dev-services.sh [start|stop|status]
#
# Exposes:
#   DATABASE_URL=postgres://postgres@localhost:5433/pictionary_test
#   REDIS_URL=redis://localhost:6380
set -euo pipefail

PG_PORT="${PG_PORT:-5433}"
PG_DATA="${PG_DATA:-/tmp/pgdata}"
PG_SOCKET_DIR="${PG_SOCKET_DIR:-/tmp}"
PG_DB="${PG_DB:-pictionary_test}"
REDIS_PORT="${REDIS_PORT:-6380}"

PG_BIN="${PG_BIN:-}"
if [[ -z "$PG_BIN" ]]; then
  if command -v pg_ctl >/dev/null 2>&1; then
    PG_BIN="$(dirname "$(command -v pg_ctl)")"
  else
    PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  fi
fi
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/pg_ctl" ]]; then
  echo "pg_ctl not found. Install Postgres 16 or set PG_BIN." >&2
  exit 1
fi

# initdb and postgres refuse to run as root. If we are root, run them as the
# "postgres" OS user (Debian package creates it). Otherwise run as ourselves.
run_pg() {
  if [[ "$(id -u)" -eq 0 ]]; then
    if id postgres >/dev/null 2>&1; then
      runuser -u postgres -- "$@"
    else
      echo "Running as root and no 'postgres' user exists. Run this script as a normal user." >&2
      exit 1
    fi
  else
    "$@"
  fi
}

pg_running() {
  "$PG_BIN/pg_isready" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -q 2>/dev/null
}

start_pg() {
  if pg_running; then
    echo "postgres: already running on port $PG_PORT"
  else
    if [[ ! -f "$PG_DATA/PG_VERSION" ]]; then
      echo "postgres: initdb -> $PG_DATA"
      mkdir -p "$PG_DATA"
      if [[ "$(id -u)" -eq 0 ]]; then chown postgres:postgres "$PG_DATA"; fi
      run_pg "$PG_BIN/initdb" -D "$PG_DATA" -U postgres --auth=trust --no-locale --encoding=UTF8 >/dev/null
    fi
    echo "postgres: starting on port $PG_PORT (socket dir $PG_SOCKET_DIR)"
    run_pg "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$PG_DATA/server.log" \
      -o "-p $PG_PORT -k $PG_SOCKET_DIR -c listen_addresses=localhost -c fsync=off -c synchronous_commit=off" \
      -w start >/dev/null
  fi
  # Create the test database if missing.
  if ! "$PG_BIN/psql" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -U postgres -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$PG_DB"; then
    echo "postgres: createdb $PG_DB"
    "$PG_BIN/createdb" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -U postgres "$PG_DB"
  fi
  # A role named after the current OS user lets a URL without a user work.
  local me; me="$(id -un)"
  if [[ "$me" != "postgres" ]]; then
    "$PG_BIN/psql" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -U postgres -d postgres -qtAc \
      "SELECT 1 FROM pg_roles WHERE rolname='$me'" | grep -q 1 || \
      "$PG_BIN/psql" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -U postgres -d postgres -qc "CREATE ROLE \"$me\" SUPERUSER LOGIN" >/dev/null
  fi
}

stop_pg() {
  if pg_running; then
    run_pg "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast -w stop >/dev/null && echo "postgres: stopped"
  else
    echo "postgres: not running"
  fi
}

redis_running() {
  redis-cli -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG
}

start_redis() {
  if redis_running; then
    echo "redis: already running on port $REDIS_PORT"
  else
    echo "redis: starting on port $REDIS_PORT"
    redis-server --port "$REDIS_PORT" --daemonize yes --save "" --appendonly no \
      --dir /tmp --logfile /tmp/redis-$REDIS_PORT.log >/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      redis_running && break
      sleep 0.2
    done
  fi
}

stop_redis() {
  if redis_running; then
    redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
    echo "redis: stopped"
  else
    echo "redis: not running"
  fi
}

status() {
  if pg_running; then echo "postgres: up (port $PG_PORT)"; else echo "postgres: down"; fi
  if redis_running; then echo "redis: up (port $REDIS_PORT)"; else echo "redis: down"; fi
}

case "${1:-start}" in
  start)
    start_pg
    start_redis
    echo
    echo "export DATABASE_URL=postgres://postgres@localhost:$PG_PORT/$PG_DB"
    echo "export REDIS_URL=redis://localhost:$REDIS_PORT"
    ;;
  stop) stop_redis; stop_pg ;;
  status) status ;;
  *) echo "usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac
