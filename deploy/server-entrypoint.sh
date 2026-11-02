#!/bin/sh
# Apply migrations, then start the arena server.
set -eu
cd /app/apps/server
echo "[entrypoint] applying migrations"
node dist/db/migrate.js
echo "[entrypoint] starting server"
exec node dist/main.js
