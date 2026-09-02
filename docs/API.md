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
a phone app cannot write clinical records, vitals or workouts directly. Its
read counterpart, `read:health_connect`, is separate and is **not** implied by
it — the phone delivers records, it does not read the retained history back
out. `read:all` satisfies both reads.

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
| GET | `/api/v1/nutrition/daily` | `read:nutrition` | Daily nutrition totals (`?start_date=`, `?end_date=`, `?source_package=`, `?limit=`) |
| POST | `/api/v1/integrations/health-connect/webhook` | `write:health_connect` | Health Connect webhook receiver (HMAC-signed) |
| GET | `/api/v1/integrations/health-connect/inventory` | `read:health_connect` | Retained source inventory (`?integration_id=`, `?record_type=`, `?source_package=`) |
| GET | `/api/v1/integrations/health-connect/records` | `read:health_connect` | Retained raw records — bounded & cursor-paginated |

### Which endpoint to read

| You want | Read |
|---|---|
| Actual daily food intake | `/api/v1/nutrition/daily` |
| Canonical daily activity & other approved metrics | `/api/v1/vitals` (+ `/api/v1/metrics`) |
| Completed programmed workouts | `/api/v1/workouts` |
| Raw-only or not-yet-productized Health Connect records | `/api/v1/integrations/health-connect/records` |
| Source coverage & ingestion diagnostics | `/api/v1/integrations/health-connect/inventory` |

Raw records are **diagnostic/source** data: deduplicated, but not
unit-normalized and not deconflicted against the direct Oura, Renpho and myAir
bridges. Prefer the canonical domain endpoints for analytics.

## Daily nutrition

```bash
curl -H "Authorization: Bearer ohts_pat_..." "https://your-instance/api/v1/nutrition/daily?start_date=2026-08-31&end_date=2026-09-01"
```

```json
[
  { "date": "2026-08-31", "source_package": "com.sbs.diet",
    "calories": 2147.099, "protein_grams": 190.913, "carbs_grams": 199.891,
    "fat_grams": 70.927, "fiber_grams": null, "sugar_grams": null,
    "sodium_milligrams": null, "record_count": 10,
    "updated_at": "2026-09-01T23:30:11.204Z" }
]
```

- One row per (America/Phoenix calendar date, exact source package).
- Date filters are **inclusive**; `source_package` matches by exact equality.
- A `null` nutrient is **unknown**, never zero — `0` means the source reported
  zero. Nullable fields stay nullable in every response.
- Canonical snapshots only: individual food records are never returned here.

## Reading retained Health Connect data

```bash
curl -H "Authorization: Bearer ohts_pat_..." "https://your-instance/api/v1/integrations/health-connect/inventory"

curl -H "Authorization: Bearer ohts_pat_..." "https://your-instance/api/v1/integrations/health-connect/records?record_type=nutrition&start_at=2026-08-01T00:00:00Z&end_at=2026-09-02T00:00:00Z&limit=50"
```

The records endpoint is bounded on purpose, with no permissive defaults:

- `integration_id` **or** `record_type` is required;
- an explicit `start_at`/`end_at` range is required, spanning at most 400 days;
- pages are cursor-paginated (`next_cursor`), max 200 records.

A missing bound is a `400`, never a full dump. Responses never contain HMAC
secrets, PAT hashes, encrypted credentials, request body digests, or another
user's records.

## Writing vitals (device bridges)

Record shape (snake_case):

```json
{ "metric_key": "ahi", "value": 2.4, "recorded_at": "2026-07-09", "source": "myair" }
```

- `metric_key` must exist in the closed metric registry (`GET /api/v1/metrics`).
- Ordinal metrics take `value_label` (e.g. `"solid"`) or a 1-based integer `value`.
- `unit` is optional. When present it must be an **accepted input unit** for the
  metric: the canonical unit, or a registered alternate that HealthTrack
  converts server-side (metrics stored in `lbs` accept `kg`; metrics stored in
  `in` accept `cm`). Omitting it declares the value already canonical. Any other
  unit is a `400` — HealthTrack never guesses. Responses always echo the
  normalized value and the canonical unit.
- `recorded_at` is day-normalized unless the metric is intraday-capable
  (`blood_glucose`, `bp_systolic`, `bp_diastolic`).
- `source` is a free-form identifier for the submitting integration. Use
  whatever names your bridge, e.g. `example_tape`, `mobile_health_bridge`,
  `manual_import`.
- `metadata` is opaque provenance owned by the submitting integration: stored
  and echoed verbatim, never interpreted as a canonical value.
- Writes are **idempotent** on `(metric_key, recorded_at, source)` — re-pushing
  updates instead of duplicating, so bridges can safely re-send.
- Batch: `{ "records": [...] }`, max 500; per-record errors reported by index
  without aborting the rest.

### Body measurements (circumferences)

HealthTrack is source-agnostic: it owns the canonical vocabulary, validation,
normalization, storage and presentation. **Integrations map their own source
schema onto these keys before submitting** — there is no vendor-specific logic
in the API, and no allowlist of approved sources.

| Region | Unsided | Left | Right |
| --- | --- | --- | --- |
| Neck | `neck` | — | — |
| Shoulder | `shoulder` | — | — |
| Chest | `chest` | — | — |
| Waist | `waist` | — | — |
| Abdomen | `abdomen` | — | — |
| Hips | `hips` | — | — |
| Bicep | `bicep` | `left_bicep` | `right_bicep` |
| Forearm | `forearm` | `left_forearm` | `right_forearm` |
| Thigh | `thigh` | `left_thigh` | `right_thigh` |
| Calf | `calf` | `left_calf` | `right_calf` |

- **Side semantics.** An unsided key is an unspecified, overall or
  caller-derived measurement. `left_*` and `right_*` are **independent series**.
  HealthTrack never copies, averages or derives one from another — send exactly
  the series you measured.
- **Units.** Every circumference accepts `in` or `cm`. The canonical stored unit
  is `in`; centimetres are divided by 2.54 before persistence and the result is
  stored **unrounded**, at ordinary double precision — `96.8 cm` persists and
  reads back as `38.11023622047244`, not `38.1102` or `38.1`. Rounding to the
  metric's one-decimal display precision happens only at render time, so no
  submitted detail is discarded on the way in.

  The one exception is mass: metrics stored in `lbs` quantize a `kg` conversion
  to a tenth of a pound. That is long-standing stored-value behaviour shared
  with manual entry, not display rounding.
- **Derived values** such as waist-to-hip ratio are not stored. Compute them
  from the canonical measurements when you need them.
- Preserving the original submitted value in `metadata` is welcome but never
  required.

```json
{
  "records": [
    {
      "metric_key": "waist",
      "value": 96.8,
      "unit": "cm",
      "recorded_at": "2026-09-01",
      "source": "example_tape",
      "metadata": {
        "external_record_id": "synthetic-record-1",
        "device_type": "smart_tape"
      }
    },
    {
      "metric_key": "left_bicep",
      "value": 14.1,
      "unit": "in",
      "recorded_at": "2026-09-01",
      "source": "example_tape"
    }
  ]
}
```

Read them back per metric via `GET /api/v1/vitals?metric=left_bicep`, or as a
week-end snapshot via `body.measurements_latest` on
`GET /api/v1/weeks/{weekStart}` — a **sparse** object keyed by canonical metric
key (`value`, `unit`, `recorded_at`, `source`), holding the latest reading on or
before that week's Sunday. Metrics with no reading are **absent rather than
null**. `body.neck_latest` / `body.waist_latest` still carry the same readings
in their original three-field shape.

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
- The ingestion contract covers the **complete** pinned relay schema (35 record
  arrays). Unknown fields and unknown top-level keys are retained verbatim and
  never fail a delivery; known records are structurally validated, and failures
  are counted (`normalization.invalid_records`) without discarding the valid
  records delivered alongside them.

## Backfilling history

The repo ships a reference importer with a `--dry-run` validation mode:

```bash
npx tsx scripts/import-devices-backfill.ts --file backfill.json --dry-run
```

File format and reconciliation details: [backfill-format.md](backfill-format.md).
