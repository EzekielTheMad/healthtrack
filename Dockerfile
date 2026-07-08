# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# deps: install node_modules. better-sqlite3 compiles its native binding here
# (python3/make/g++ needed in build stages only — never in the runner).
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# build: Next.js standalone output + bundled migration runner.
# No secrets are baked in: all env reads in the app are request-time/lazy.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Self-contained migration runner; better-sqlite3 stays external and resolves
# from the standalone node_modules at runtime.
RUN npx esbuild scripts/db-migrate.ts --bundle --platform=node --format=cjs \
    --alias:@=./src --external:better-sqlite3 --outfile=db-migrate.js

# ---------------------------------------------------------------------------
# runner: minimal runtime image. su-exec drops root -> PUID:PGID in the
# entrypoint; wget serves the HEALTHCHECK.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
RUN apk add --no-cache su-exec wget
WORKDIR /app

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DRIZZLE_MIGRATIONS_DIR=/app/drizzle \
    NEXT_TELEMETRY_DISABLED=1

# Standalone server (includes server.js + traced node_modules with the
# compiled better-sqlite3 binding).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/db-migrate.js ./db-migrate.js
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
