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

## Backfilling history

The repo ships a reference importer with a `--dry-run` validation mode:

```bash
npx tsx scripts/import-devices-backfill.ts --file backfill.json --dry-run
```

File format and reconciliation details: [backfill-format.md](backfill-format.md).
