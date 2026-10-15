#!/bin/bash
# Starts everything in this one container: SQL Server → database set-up → the Ramas API (which also serves the React app).
# If either SQL Server or the API stops, the other one is stopped too and the container exits
# (docker-compose.yml restarts it: restart: unless-stopped).
set -u

if [ -z "${MSSQL_SA_PASSWORD:-}" ]; then
  echo "MSSQL_SA_PASSWORD is not set (see docker/.env.example)" >&2
  exit 1
fi

/opt/mssql/bin/sqlservr &
sql_pid=$!
app_pid=""

stop_all() {
  [ -n "$app_pid" ] && kill -TERM "$app_pid" 2>/dev/null
  kill -TERM "$sql_pid" 2>/dev/null
  wait
}
trap 'stop_all; exit 0' TERM INT

# RAMAS_INIT_DB=0 skips the set-up (e.g. while restoring a database by hand)
if [ "${RAMAS_INIT_DB:-1}" = "1" ]; then
  if ! node /app/server/scripts/docker-init-db.js; then
    stop_all
    exit 1
  fi
fi

node /app/server/src/server.js &
app_pid=$!

wait -n "$sql_pid" "$app_pid"
status=$?
echo "A process stopped (exit $status) — stopping the container" >&2
stop_all
exit "$status"
