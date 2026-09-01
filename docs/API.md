# HealthTrack API

Condensed reference for GitHub browsing. **The canonical, always-current docs
are served by every instance itself** (no account needed — API shape only, no
user data):

- `<your-instance>/docs/api` — human cookbook: token setup, endpoints with
  curl examples, the full metric registry
- `<your-instance>/api/v1/openapi.json` — OpenAPI 3.1 document
- `<your-instance>/api/v1/metrics` — metric registry as JSON

## Authentication

Create a personal access token in **Settings → API Keys** and send it as a
bearer token:

```bash
curl -H "Authorization: Bearer ohts_pat_..." https://your-instance/api/v1/vitals
```

Tokens carry scopes (`read:vitals`, `write:vitals`, per-domain reads,
`read:all`, `write:all`). Every token resolves to exactly one user; all reads
and writes are hard-scoped to that user's own data.

`write:health_connect` is a deliberately narrow ingest scope: it admits the
Health Connect webhook receiver and nothing else, so the token you paste into
a phone app cannot write clinical records, vitals or workouts directly.

## Endpoints

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/api/v1` | — | API index |
| GET | `/api/v1/metrics` | — (public) | Metric registry as JSON |
| GET | `/api/v1/openapi.json` | — (public) | OpenAPI 3.1 document |
| GET | `/api/v1/vitals` | `read:vitals` | List vitals (`?metric=`, `?days=`, `?limit=`) |
| POST | `/api/v1/vitals` | `write:vitals` | Upsert one vital record |
| POST | `/api/v1/vitals/batch` | `write:vitals` | Upsert up to 500 records in one transaction |
| GET | `/api/v1/medications` | `read:medications` | List medications (`?include_inactive=`) |
| GET | `/api/v1/conditions` | `read:conditions` | List conditions |
| GET | `/api/v1/allergies` | `read:allergies` | List allergies |
| GET | `/api/v1/labs` | `read:labs` | List lab results (`?test=`, `?days=`) |
| GET | `/api/v1/procedures` | `read:procedures` | List procedures |
| GET | `/api/v1/vaccines` | `read:vaccines` | List vaccine records |
| GET | `/api/v1/providers` | `read:providers` | List providers |
| GET | `/api/v1/profile` | `read:profile` | User profile |
| GET | `/api/v1/summary` | `read:all` | Full health summary |
| GET | `/api/v1/nutrition/daily` | `read:nutrition` | Daily nutrition totals (`?start_date=`, `?end_date=`, `?source_package=`) |
| POST | `/api/v1/integrations/health-connect/webhook` | `write:health_connect` | Health Connect webhook receiver (HMAC-signed) |

## Writing vitals (device bridges)

Record shape (snake_case):

```json
{ "metric_key": "ahi", "value": 2.4, "recorded_at": "2026-07-09", "source": "myair" }
```

- `metric_key` must exist in the closed metric registry (`GET /api/v1/metrics`).
- Ordinal metrics take `value_label` (e.g. `"solid"`) or a 1-based integer `value`.
- `unit` is optional and must match the canonical unit (`weight` also accepts `kg`).
- `recorded_at` is day-normalized unless the metric is intraday-capable
  (`blood_glucose`, `bp_systolic`, `bp_diastolic`).
- Writes are **idempotent** on `(metric_key, recorded_at, source)` — re-pushing
  updates instead of duplicating, so bridges can safely re-send.
- Batch: `{ "records": [...] }`, max 500; per-record errors reported by index
  without aborting the rest.

## Health Connect ingestion (Android)

The [Life Dashboard companion app](https://github.com/owen282000/life-dashboard-companion-app)
can POST Health Connect records straight to an instance. Set it up in
**Settings → Health Connect**; full walkthrough in
[health-connect.md](health-connect.md).

```
POST /api/v1/integrations/health-connect/webhook
Authorization: Bearer ohts_pat_...          # scope: write:health_connect
X-Signature: sha256=<hex HMAC-SHA256(secret, exact raw request body)>
```

- The signature covers the **exact raw request bytes** and is compared in
  constant time. Required in production.
- Accepted records are retained losslessly with their Health Connect UUID and
  writing Android package; deduplication is
  `(user, record_type, source_package, source_uuid)`.
- A new integration starts in **inventory** mode — nothing is written
  canonically until you approve exact source packages.
- Approved today: daily activity totals → vitals (source
  `health_connect_daily`) and MacroFactor nutrition → `nutrition_daily`.
  Everything else stays raw-only; Oura, Renpho and myAir keep ownership of
  their metrics.

## Backfilling history

The repo ships a reference importer with a `--dry-run` validation mode:

```bash
npx tsx scripts/import-devices-backfill.ts --file backfill.json --dry-run
```

File format and reconciliation details: [backfill-format.md](backfill-format.md).
