# HealthTrack API

Condensed reference for GitHub browsing. **The canonical, always-current docs
are served by every instance itself** (no account needed — API shape only, no
user data):

- `<your-instance>/docs/api` — human cookbook: token setup, endpoints with
  curl examples, the full metric registry
- `<your-instance>/api/v1/openapi.json` — OpenAPI 3.1 document
- `<your-instance>/api/v1/metrics` — metric registry as JSON

## Authentication

Create a personal access token in **Settings → Advanced & about → API access**
and send it as a bearer token:

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

| Method | Path                                            | Scope                  | Description                                                                          |
| ------ | ----------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/api/v1`                                       | —                      | API index                                                                            |
| GET    | `/api/v1/metrics`                               | — (public)             | Metric registry as JSON                                                              |
| GET    | `/api/v1/openapi.json`                          | — (public)             | OpenAPI 3.1 document                                                                 |
| GET    | `/api/v1/vitals`                                | `read:vitals`          | List vitals (`?metric=`, `?days=`, `?limit=`)                                        |
| POST   | `/api/v1/vitals`                                | `write:vitals`         | Upsert one vital record                                                              |
| POST   | `/api/v1/vitals/batch`                          | `write:vitals`         | Upsert up to 500 records in one transaction                                          |
| GET    | `/api/v1/medications`                           | `read:medications`     | List medications (`?include_inactive=`)                                              |
| GET    | `/api/v1/conditions`                            | `read:conditions`      | List conditions                                                                      |
| GET    | `/api/v1/allergies`                             | `read:allergies`       | List allergies                                                                       |
| GET    | `/api/v1/labs`                                  | `read:labs`            | List lab results (`?test=`, `?days=`)                                                |
| GET    | `/api/v1/procedures`                            | `read:procedures`      | List procedures                                                                      |
| GET    | `/api/v1/vaccines`                              | `read:vaccines`        | List vaccine records                                                                 |
| GET    | `/api/v1/providers`                             | `read:providers`       | List providers                                                                       |
| GET    | `/api/v1/profile`                               | `read:profile`         | User profile                                                                         |
| GET    | `/api/v1/summary`                               | `read:all`             | Full health summary                                                                  |
| GET    | `/api/v1/nutrition/daily`                       | `read:nutrition`       | Daily nutrition totals (`?start_date=`, `?end_date=`, `?source_package=`, `?limit=`) |
| POST   | `/api/v1/integrations/health-connect/webhook`   | `write:health_connect` | Health Connect webhook receiver (HMAC-signed)                                        |
| GET    | `/api/v1/integrations/health-connect/inventory` | `read:health_connect`  | Retained source inventory (`?integration_id=`, `?record_type=`, `?source_package=`)  |
| GET    | `/api/v1/integrations/health-connect/records`   | `read:health_connect`  | Retained raw records — bounded & cursor-paginated                                    |

### Which endpoint to read

| You want                                               | Read                                            |
| ------------------------------------------------------ | ----------------------------------------------- |
| Actual daily food intake                               | `/api/v1/nutrition/daily`                       |
| Canonical daily activity & other approved metrics      | `/api/v1/vitals` (+ `/api/v1/metrics`)          |
| Completed programmed workouts                          | `/api/v1/workouts`                              |
| Raw-only or not-yet-productized Health Connect records | `/api/v1/integrations/health-connect/records`   |
| Source coverage & ingestion diagnostics                | `/api/v1/integrations/health-connect/inventory` |

Raw records are **diagnostic/source** data: deduplicated, but not
unit-normalized and not deconflicted against the direct Oura, Renpho and myAir
bridges. Prefer the canonical domain endpoints for analytics.

## Daily nutrition

```bash
curl -H "Authorization: Bearer ohts_pat_..." "https://your-instance/api/v1/nutrition/daily?start_date=2026-08-31&end_date=2026-09-01"
```

```json
[
  {
    "date": "2026-08-31",
    "source_package": "com.sbs.diet",
    "calories": 2147.099,
    "protein_grams": 190.913,
    "carbs_grams": 199.891,
    "fat_grams": 70.927,
    "fiber_grams": null,
    "sugar_grams": null,
    "sodium_milligrams": null,
    "record_count": 10,
    "updated_at": "2026-09-01T23:30:11.204Z"
  }
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
- Read responses include `last_received_at`, the server time of the latest
  accepted insert or upsert. This is separate from the device observation's
  `recorded_at`. Legacy rows return `null` until a delivery updates them; do not
  interpret an unknown receipt time or an absent reading as zero.
- Batch: `{ "records": [...] }`, max 500; per-record errors reported by index
  without aborting the rest.

### Source selection and integration status

The vitals endpoints continue to return each source's observations. Product
trends, weekly summaries, and context use one source per metric: an explicit
choice in Vitals takes priority, Health Connect aggregate activity totals are
the default when available, and other competing sources require a visible
choice. A missing reading from the selected source stays missing; another
device does not silently fill it. Source choices currently apply to your own
record; competing sources in dependent or delegated records are omitted.

Settings → Integrations separates native Oura sync outcomes from accepted
push deliveries. It reports last full success, partial/error status, rate-limit
retry time, server receipt time, and measurement date. Renpho, myAir, and other
external bridges control their own authorization and schedules; HealthTrack
cannot verify those upstream connections or trigger their syncs. Start Health
Connect deliveries from the companion phone app. Refresh status only reads
metadata already retained by HealthTrack.

New Oura authorization requests include `stress` alongside `daily`, `heartrate`,
`spo2` and `personal`. Existing grants do not gain a scope through refresh or an
application upgrade. The owner can use **Review Oura permissions** in Settings
and review Oura's consent screen. A missing Resilience permission leaves other
usable feeds active and reports partial coverage; genuine terminal token
failures still require reconnection.

### Session-only metric comparison

`GET /api/metric-comparison?days=30|90` supports Vitals → Compare. It requires a
signed-in application session and returns `Cache-Control: no-store`, including
on errors. A bearer PAT alone is not accepted, even with `read:all`. This is an
application route, separate from the public v1/OpenAPI contract and existing
PAT endpoints.

The default window is 30 days. Both choices include today in the instance's
configured reporting timezone. Query parameters select exactly one person:

| Query | Result |
| ----- | ------ |
| No person parameter | The signed-in owner's own records. |
| `dependent_id=<id>` | One authorized dependent's vitals. |
| `owner_id=<id>` | An authorized delegate views that owner's own vitals; dependent observations are excluded. |

Nutrition and fitness are included only for the signed-in owner's own
comparison. Dependent and delegate responses list both in
`unavailable_domains`. Unknown or unauthorized people return 404; anonymous
requests return 401. `dependent_id=all`, mixed external-owner/dependent
requests, repeated scope/window parameters and windows other than 30/90 return
400. No route writes records or source preferences.

The snake_case response has this shape:

| Field | Meaning |
| ----- | ------- |
| `days`, `start_date`, `end_date`, `time_zone` | Window length, inclusive calendar bounds and reporting timezone. |
| `metrics` | Available vital, nutrition and fitness metric catalog with source series. |
| `unavailable_domains` | Domains unavailable for the selected person. |
| `warnings` | Unsupported values/units, partial fitness coverage or bounded-history warnings. |

Each metric includes `key`, `label`, `unit` (nullable), `domain`, `aggregation`,
`selected_source` and `sources`. Keys use `vital:<registry_key>`,
`nutrition:calories|protein|carbs|fat`, or
`fitness:duration_min|volume_lbs`. A source contains `source`, `label`,
`recorded_days` and `points`, with one `{date, value}` for every window day.
`null` means unknown or unrecorded; numeric `0` is a recorded zero. Values are
never carried forward between days. Unsupported legacy units produce gaps and
a warning rather than a guessed conversion.

`selected_source: null` requires a visible source choice. Vital selection uses
the owner's saved preference, otherwise Health Connect for overlapping
activity totals, otherwise the only source when unambiguous. A saved source
with no observations remains selected with zero recorded days. Competing
nutrition snapshots remain separate. The UI may choose another source locally
without saving a global preference, including for authorized dependent and
delegate comparisons; this does not change ordinary vital-list behavior.

`aggregation` describes the operation **within each day**: means for applicable
readings, latest snapshots for daily device totals/nutrition/latest-value
metrics, or sums of logged workout sessions. Repeated daily device snapshots
and competing feeds are not summed. Training duration includes known durations
only. Working-set volume uses parsed weight/reps, excludes warmups and doubles
per-side sets; absent qualifying sets stay unknown. Fitness warnings describe
these coverage limits.

Reads are bounded to 20,000 vital rows, 1,000 nutrition snapshots and 1,000
workout sessions. Truncated reads produce warnings that coverage may be
incomplete; nutrition also warns conservatively when its repository cap is
reached. The response provides aligned observations, not a correlation estimate
or a causal conclusion. See [v2 behavior](V2.md#comparisons-and-oura-permission-review-200-rc3).

### Body measurements (circumferences)

HealthTrack is source-agnostic: it owns the canonical vocabulary, validation,
normalization, storage and presentation. **Integrations map their own source
schema onto these keys before submitting** — there is no vendor-specific logic
in the API, and no allowlist of approved sources.

| Region   | Unsided    | Left           | Right           |
| -------- | ---------- | -------------- | --------------- |
| Neck     | `neck`     | —              | —               |
| Shoulder | `shoulder` | —              | —               |
| Chest    | `chest`    | —              | —               |
| Waist    | `waist`    | —              | —               |
| Abdomen  | `abdomen`  | —              | —               |
| Hips     | `hips`     | —              | —               |
| Bicep    | `bicep`    | `left_bicep`   | `right_bicep`   |
| Forearm  | `forearm`  | `left_forearm` | `right_forearm` |
| Thigh    | `thigh`    | `left_thigh`   | `right_thigh`   |
| Calf     | `calf`     | `left_calf`    | `right_calf`    |

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
**Settings → Integrations → Health Connect**; full walkthrough in
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
