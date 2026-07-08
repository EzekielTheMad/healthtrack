#!/bin/sh
# Container entrypoint. Runs as root just long enough to fix /data
# ownership, then drops to PUID:PGID (Unraid conventions: 99/100) for
# migrations and the server itself.
set -eu

PUID="${PUID:-99}"
PGID="${PGID:-100}"

mkdir -p /data/uploads /data/keys

# chown -R only when ownership doesn't match (fast path on restarts).
if [ "$(stat -c '%u:%g' /data)" != "${PUID}:${PGID}" ]; then
  echo "[entrypoint] fixing /data ownership -> ${PUID}:${PGID}"
  chown -R "${PUID}:${PGID}" /data
fi

echo "[entrypoint] applying database migrations"
su-exec "${PUID}:${PGID}" node /app/db-migrate.js

echo "[entrypoint] starting HealthTrack as ${PUID}:${PGID}"
exec su-exec "${PUID}:${PGID}" node /app/server.js
