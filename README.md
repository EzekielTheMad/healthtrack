# HealthTrack

[![License: MIT](https://img.shields.io/badge/License-MIT-teal.svg)](LICENSE)
[![CI](https://github.com/EzekielTheMad/healthtrack/actions/workflows/ci.yml/badge.svg)](https://github.com/EzekielTheMad/healthtrack/actions/workflows/ci.yml)

**Self-hosted personal & family health tracker.** Medications, conditions, allergies, labs, vitals, procedures, vaccines, appointments and notes — for you and your dependents — in a single Docker container. All data stays in one SQLite database and an uploads folder on **your** server. No cloud services required.

## Features

- **Medications** — dosages, schedules, active/inactive history, AI interaction checks*
- **Conditions, allergies, procedures, vaccines** — full clinical history
- **Labs** — visits and results with reference ranges, plus AI-powered PDF parsing of lab and vaccine reports*
- **Vitals** — blood pressure, heart rate, weight, glucose and more, with reference ranges and trend charts
- **Family & dependents** — track children or family members under your account, with a transition flow when they grow up
- **Sharing** — share selected sections of your (or a dependent's) health record with another user, with expiry
- **Delegates** — grant another user read-only or read-write access to manage a record
- **API access** — personal access tokens with scoped permissions for the REST API (`/api/v1/...`), including read endpoints for every domain
- **Device integrations / bring your own bridge** — push metrics from any device (CPAP, smart scale, watch, CGM, …) via `POST /api/v1/vitals` and `/api/v1/vitals/batch` with idempotent upserts; see [docs/API.md](docs/API.md). Every instance self-documents at `/docs/api` (human cookbook) and `/api/v1/openapi.json` (OpenAPI 3.1) — both public, API-shape only
- **AI health assistant*** — natural-language questions about your data, health summaries
- **Oura Ring sync*** — sleep, heart rate and activity data
- **Sign in with Google*** — alongside built-in email/password auth

\* Optional. AI features need an `ANTHROPIC_API_KEY`, Google login needs a Google OAuth client, Oura sync needs an Oura OAuth client. Each feature is hidden in the UI until its keys are configured — the core tracker is fully functional without any of them.

## Quick start

```bash
docker run -d \
  --name healthtrack \
  -p 3000:3000 \
  -v ./data:/data \
  -e APP_URL=http://localhost:3000 \
  ghcr.io/ezekielthemad/healthtrack:latest
```

Open http://localhost:3000 and register — **the first user becomes the instance admin**. After that, registration is **invite-only by default**: create single-use invite links under **Settings → Invites** to add family members. (Set `SIGNUPS_ENABLED=true` to open registration to anyone, or `false` to close it completely.)

> **Port 3000 already in use?** Map a different host port and point `APP_URL` at
> it, e.g. `-p 3005:3000` with `-e APP_URL=http://localhost:3005`. The container
> always listens on 3000 internally; only the host side changes.

### Docker Compose

See [`docker-compose.yml`](docker-compose.yml):

```bash
docker compose up -d
```

## Unraid

HealthTrack ships a Community Applications template: [`unraid/healthtrack.xml`](unraid/healthtrack.xml). See [docs/UNRAID.md](docs/UNRAID.md) for install instructions (via CA or manual template URL).

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `APP_URL` | **yes** | `http://localhost:3000` | Absolute URL of the instance — must match what users browse to; used for auth callbacks |
| `AUTH_SECRET` | no | auto-generated to `/data/keys` | Session signing secret |
| `ENCRYPTION_KEY` | no | auto-generated to `/data/keys` | Encrypts stored OAuth tokens |
| `SIGNUPS_ENABLED` | no | invite-only | Unset: first account registers freely (becomes admin), everyone after needs a single-use invite link (Settings → Invites). `true`: open registration. `false`: fully closed |
| `ANTHROPIC_API_KEY` | no | — | Enables AI features (summaries, queries, PDF parsing, interaction checks) |
| `ANTHROPIC_MODEL` | no | current Sonnet | Claude model for reasoning features (summaries, queries, interaction checks) — e.g. `claude-opus-4-8` |
| `ANTHROPIC_MODEL_EXTRACTION` | no | current Sonnet | Claude model for PDF extraction — a cheaper model like `claude-haiku-4-5` works well |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | — | Enables "Sign in with Google" |
| `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` | no | — | Enables Oura Ring sync |
| `PUID` / `PGID` | no | `99` / `100` | Ownership of files under `/data` (Unraid conventions) |
| `TZ` | no | `Etc/UTC` | Container time zone |

### Reverse proxy / HTTPS

HealthTrack serves plain HTTP on port 3000; put your reverse proxy of choice (Nginx Proxy Manager, Caddy, Traefik, Cloudflare Tunnel, …) in front of it for HTTPS. **`APP_URL` must exactly match the URL users browse to** (scheme, host, port) or login callbacks will fail.

### Authentication & OAuth

Built-in **email/password** sign-in works anywhere, including a bare LAN IP — nothing extra to configure. The optional social logins have provider-specific requirements:

- **Sign in with Google** requires a **public HTTPS URL on a real hostname**. Google's OAuth rejects `http://` and raw IP-address redirect URIs (only `http://localhost` is exempt), so it will **not** work against something like `http://192.168.1.50:3000` — you must front the app with HTTPS (reverse proxy or tunnel) and set `APP_URL` to that address. Then, in the **Google Cloud Console** OAuth client, add this Authorized redirect URI:

  ```
  APP_URL/api/auth/callback/google
  ```

- **Oura Ring** is more permissive (a LAN IP is fine). Register its redirect URI in the **Oura developer portal** — *not* the Google console; they are separate providers with separate credentials:

  ```
  APP_URL/api/oura/callback
  ```

In every case `APP_URL` must exactly match the URL your browser uses (scheme, host **and** port), or the OAuth round-trip fails. Restart the container after changing `APP_URL`. The first user to sign in — by any method — becomes the admin.

### Backup

Everything lives under `/data`: the SQLite database (`healthtrack.db`), uploaded PDFs (`uploads/`) and auto-generated secrets (`keys/`). To back up: stop the container, copy the `/data` directory, start it again. Restore is the reverse.

## Development

```bash
npm install
npm run dev     # http://localhost:3000, state lands in ./data
npm test        # vitest
npm run lint
npm run build
```

Local development state (SQLite db, uploads, generated keys) lives in `./data` (override with `DATA_DIR`). Database tests run in the node environment — see existing `*.test.ts` files for the environment pragma convention.

## Disclaimer

HealthTrack helps you **organize** health information. It is **not a medical device and does not provide medical advice**, diagnosis or treatment — always consult a qualified healthcare professional. AI-generated content can be wrong. You run this software self-hosted, on your own infrastructure, at your own responsibility; review [SECURITY.md](SECURITY.md) before exposing an instance to the internet.

## License

[MIT](LICENSE)
