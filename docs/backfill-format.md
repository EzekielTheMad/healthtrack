# Backfill file format

Input format for `scripts/import-devices-backfill.ts`, the reference bridge
implementation that seeds a HealthTrack instance with historical device
metrics via `POST /api/v1/vitals/batch`. For the full API reference see
[docs/API.md](API.md) or your instance's live docs at `<your-instance>/docs/api`.

## File shape

A single JSON **array** of record objects:

```json
[
  {
    "metric_key": "sleep_duration",
    "value": 7.4,
    "recorded_at": "2026-06-01",
    "source": "oura"
  },
  {
    "metric_key": "resilience",
    "value_label": "solid",
    "recorded_at": "2026-06-01",
    "source": "oura"
  },
  {
    "metric_key": "weight",
    "value": 80.2,
    "unit": "kg",
    "recorded_at": "2026-06-01",
    "source": "renpho"
  }
]
```

### Record fields

| Field | Required | Notes |
|---|---|---|
| `metric_key` | yes | Must exist in the metric registry (closed registry). `GET /api/v1/metrics` on your instance returns the full list. |
| `value` | number metrics: yes | Ordinal metrics accept `value` (1-based integer) *or* `value_label`. |
| `value_label` | ordinal metrics only | e.g. `"solid"` for `resilience`. Resolved to its 1-based value; stored in `metadata.label`. |
| `unit` | no | If present, must equal the metric's canonical unit — no silent conversion. Exception: `weight` accepts `"kg"` and converts to lbs. |
| `recorded_at` | yes | ISO date (`2026-06-01`) or datetime. Normalized to day granularity (`T00:00:00Z`) unless the metric is intraday-capable (`blood_glucose`, `bp_systolic`, `bp_diastolic`), which keep the full timestamp. |
| `source` | yes | Device/bridge identifier, e.g. `oura`, `myair`, `renpho`, `samsung_health`, `manual`. Part of the upsert key. |
| `metadata` | no | Free-form JSON object stored with the row. |

### Upsert semantics

Writes are idempotent on `(metric_key, recorded_at, source)` per user:
re-importing the same file **updates** existing rows instead of duplicating
them, so it is always safe to re-run an import.

## Running the importer

```bash
# 1. Validate the file locally (no network, no token needed)
npx tsx scripts/import-devices-backfill.ts --file backfill.json --dry-run

# 2. Live import (PAT needs the write:vitals scope)
HEALTHTRACK_URL=https://your-instance \
HEALTHTRACK_TOKEN=ohts_pat_... \
  npx tsx scripts/import-devices-backfill.ts --file backfill.json
```

- Records are sent in chunks of 500 (the batch-endpoint maximum).
- A failing chunk (non-2xx or network error) is retried 3 times with
  exponential backoff, then the import aborts — remaining chunks are not sent.
- Per-record validation errors reported by the server do **not** abort the
  import; they are listed by record index in the final reconciliation:

```
Import complete.

  records read     137
  records sent     137
  inserted         130
  updated          5
  record errors    2

  errors (by record index in the file):
    [12] Unknown metric key 'sleep_scor'. ...
    [88] Unknown value_label 'ok' for 'resilience'. ...
```

Exit code is `0` only when nothing failed (dry-run: no invalid records;
live: no abort and no record errors).
