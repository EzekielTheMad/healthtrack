#!/bin/sh
# Container entrypoint. Runs as root just long enough to fix /data
# ownership, then drops to PUID:PGID (Unraid conventions: 99/100) for
# migrations and the server itself.
set -eu

PUID="${PUID:-99}"
PGID="${PGID:-100}"

mkdir -p /data/uploads /data/keys

# Normalise ownership of the whole data tree to the runtime user before
# dropping privileges. Do NOT gate this on /data's own ownership: on Unraid
# the appdata mount is pre-owned 99:100, so a top-level check passes while
# the root-created keys/ and uploads/ subdirs stay root-owned — which left
# keys/auth_secret unwritable and made better-auth 500 on every sign-in.
# The tree is small (a SQLite db + a few uploaded files), so an
# unconditional recursive chown is cheap and reliably correct.
chown -R "${PUID}:${PGID}" /data

echo "[entrypoint] applying database migrations"
su-exec "${PUID}:${PGID}" node /app/db-migrate.js

echo "[entrypoint] starting HealthTrack as ${PUID}:${PGID}"
exec su-exec "${PUID}:${PGID}" node /app/server.js
