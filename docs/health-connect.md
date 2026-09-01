# Health Connect ingestion (Android)

HealthTrack can receive Health Connect data from the
[Life Dashboard companion app](https://github.com/owen282000/life-dashboard-companion-app)
(v1.8.x) over an authenticated, HMAC-signed webhook.

The payload contract is pinned to the app's published JSON Schema at commit
`b94f7453a2d61a69bf9866d15e37ae4fb5343e21`, checked in at
`src/lib/integrations/health-connect/fixtures/webhook-schema.json`. It is never
fetched at runtime, and a drift test fails if our record table stops matching it.

## Setup

1. **Create the integration.** Settings → **Health Connect** → *Create*. The
   HMAC signing secret is shown **once** — copy it now.
2. **Create the token.** Settings → **API Access** → generate a key with only
   the `write:health_connect` scope. That scope admits the webhook receiver and
   nothing else.
3. **Configure the phone** (Life Dashboard → Health Connect):

   | Setting | Value |
   |---|---|
   | Webhook URL | `https://<your-instance>/api/v1/integrations/health-connect/webhook` |
   | Header name | `Authorization` |
   | Header value | `Bearer ohts_pat_…` |
   | Signing secret | the secret from step 1 |
   | Daily totals | **enabled** |
   | MQTT | **disabled** |

4. **Send Test Ping** from the phone. It should report delivered, and the
   delivery appears under *Recent deliveries* in Settings.
5. **Let it sync, then read the inventory.** Settings lists every record type
   and Android package your phone actually sent, with counts, date ranges and
   which optional fields each source populates.
6. **Approve exact packages** for the domains you want, tick the matching
   canonical writes, and press **Activate normalization**. Approving a package,
   enabling a canonical write, switching the nutrition strategy or activating
   the integration all **rebuild the records already retained** — you do not
   need another sync from the phone for them to take effect.

## Inventory first — always

A new integration starts in `inventory` status. In that mode the receiver
authenticates, verifies the signature, validates the envelope and stores every
accepted record losslessly — but writes **no** vitals and **no** nutrition.

This is deliberate. Health Connect aggregates whatever is installed on the
phone, and several of those apps compete with bridges that already own their
metrics here. Approval is per record type **and** per exact package name; there
is no wildcard, and package matching is exact — never prefix or substring.

## What gets normalized

| Record type | Destination | Semantic |
|---|---|---|
| `daily_totals` | vitals `steps`, `distance`, `active_calories`, `total_calories`, source `health_connect_daily` | Daily snapshot — the newest delivery **replaces** the day |
| `nutrition` | `nutrition_daily` (one row per Phoenix date + package) | Daily aggregate — the day is recomputed and **overwritten** |

`distance_meters` is converted to miles (÷ 1609.344) because miles is the
registry's canonical unit for `distance`. A metric a snapshot omits is
*unknown*: no row is written, and the day's existing value is left alone rather
than being zeroed.

Everything else stays raw-only:

- **Oura** owns sleep, HRV and resting heart rate.
- **Renpho** owns weight and body composition.
- **myAir** owns APAP metrics.
- Generic Health Connect `exercise` sessions are context only and are never
  turned into completed named strength workouts.
- Reproductive-health record types are out of scope pending a defined product
  use and a privacy review.

Raw records for those types are still inventoried, so you can shadow-compare a
source before ever deciding to promote it, and they can be read back through
`GET /api/v1/integrations/health-connect/records` (scope `read:health_connect`).

## The ingestion contract covers the whole relay

All **35** record arrays the pinned schema can emit are understood at the
ingestion boundary — steps, distance, active/total calories, heart rate,
resting heart rate, HRV, sleep sessions and stages, weight, height, body fat,
lean mass, bone mass, body-water mass, exercise sessions, blood pressure, blood
glucose, oxygen saturation, body/skin/basal temperatures, respiratory rate,
hydration, nutrition, mindfulness, BMR, VO₂ max, the reproductive-health
records, screen time and the daily aggregate totals — plus `_diagnostics` and
the backfill window metadata.

The field/type/required data for all of them is **derived** from the vendored
schema rather than hand-copied: `npm run generate:relay-schema` writes
`src/lib/integrations/health-connect/generated/relay-schema.ts`, and a drift
test fails if the checked-in file no longer matches the schema. Understanding a
type is not the same as normalizing it — see the table above for what actually
becomes canonical data.

Validation behaviour:

- Unknown top-level fields and unknown record fields are **retained verbatim**
  and never fail a delivery.
- Known record types are structurally validated against the pinned contract.
  Failures are **counted and reported** (`normalization.invalid_records` and
  `invalid_by_type`) and the records are still retained — one malformed
  heart-rate sample never discards the nutrition records delivered with it.
- A source-side shape problem is reported separately from `errors` and does not
  raise the integration's error banner.

## Reading it back (API)

Raw ingestion without a read contract is only half an integration. Two
PAT-readable endpoints expose what was retained, both requiring the dedicated
`read:health_connect` scope (`read:all` satisfies it; `write:health_connect`
does **not** — the phone's token delivers records, it does not read them back):

| Endpoint | Returns |
|---|---|
| `GET /api/v1/integrations/health-connect/inventory` | One entry per (record type × exact package): counts, first/last record instants, fields observed, canonical policy and the reason for it |
| `GET /api/v1/integrations/health-connect/records` | Retained raw records — bounded and cursor-paginated |

The records endpoint has **no permissive defaults**: `integration_id` or
`record_type` is required, an explicit `start_at`/`end_at` range is required and
may span at most 400 days, and pages cap at 200 records. A missing bound is a
`400`, never a full dump. Responses never contain HMAC secrets, PAT hashes,
encrypted credentials, body digests, or another user's records.

Raw records are **diagnostic/source** data. For analytics, prefer the canonical
domain endpoints: `/api/v1/nutrition/daily` for intake, `/api/v1/vitals` for
approved daily metrics, `/api/v1/workouts` for completed workouts.

## Nutrition is a daily snapshot, not a running total

There is exactly one canonical row per (user, `America/Phoenix` date, source
package). Every sync recalculates the whole affected day from the retained,
deduplicated raw records and overwrites that row.

An incoming subtotal is **never added** to the stored total. Webhook batches
overlap, retry and carry only changed records, so an additive path would double
count. Concretely:

- Food logged later in the day updates the same row.
- The first record after the Phoenix date rolls over creates a new day's row.
- Editing a record recomputes the day from all retained records for it.
- Editing a record across midnight recomputes **both** affected days.
- A missing nutrient stays `null` (unknown) — never `0`.

### Record shape (strategy)

| Strategy | What it does | Use when |
|---|---|---|
| `sum_items` (default) | Sums every deduplicated record for the day | The source emits individual food/meal records — **MacroFactor does this** — or exactly one record per day |
| `latest_summary` | Uses only the newest record for the day | The source emits one *mutable daily summary* **alongside** item records, where summing both would double count |

MacroFactor emits individual food records with stable Health Connect UUIDs and
no daily-summary record, so `sum_items` is correct for `com.sbs.diet`.

MacroFactor's Android package is `com.sbs.diet`. That is not a built-in
allowlist — approve whatever your own inventory reports.

### Reprocess retained nutrition

Settings → Health Connect → **Reprocess retained nutrition** recomputes every
Phoenix day from the food records already stored, and reports the dates
rebuilt, rows written, records considered, records skipped and any errors.

It is safe to run repeatedly: the rebuild is a pure function of the retained
raw state, so it cannot inflate a day. Reach for it when you approved a source
after the records had already arrived, changed the strategy, or want to confirm
what the canonical rows are actually derived from.

HealthTrack stores and displays imported **actual intake**. It is not a food
logger and calculates no targets — MacroFactor remains the source of truth for
logging and dynamic targets. Imported days are shown at **/nutrition**, a
top-level page (not a Fitness sub-tab).

## Deduplication

Records dedupe on `(user, record_type, source_package, source_uuid)`:

- The same payload delivered twice is one ingest run, and no rows change.
- The same UUID in a later batch **updates** the retained record.
- The same UUID from a different package, or for a different record type, stays
  a separate record.
- A backfill overlapping a normal sync produces no duplicates.
- Records the relay delivers without a UUID are retained under an explicitly
  weaker content-derived identity, labelled `derived` in the inventory. Those
  deduplicate repeat deliveries of an unchanged record but cannot recognise an
  edited one. (`daily_totals` is the benign case: it has no UUID, but its date
  is a genuine natural key.)

## Security

- The `X-Signature` header is `sha256=<lowercase hex of HMAC-SHA256(secret,
  exact raw request body)>`. HealthTrack hashes the raw request bytes **before**
  parsing any JSON — a signature computed over re-serialized JSON will not
  verify — and compares in constant time after a length check.
- The signature is **mandatory in production**. Outside production it can be
  waived for local `curl` testing with `HEALTH_CONNECT_ALLOW_UNSIGNED=true`; a
  signature that *is* present is verified in every environment.
- The secret is stored AES-256-GCM encrypted at rest and is returned only at
  creation and explicit rotation. **Rotation invalidates the old secret
  immediately** — there is no overlap window, so the phone stops delivering
  until you paste the new secret in.
- Bodies over `HEALTH_CONNECT_MAX_BODY_BYTES` (default 2 MiB) are rejected with
  413, before authentication.
- Deliveries are rate limited per token and per user.
- Paused or errored integrations reject deliveries with 403.
- Logs carry ingest ids and counts only — never tokens, secrets, signatures or
  health values.

## Response and status codes

```json
{
  "ingest_id": "…",
  "status": "accepted",
  "records": { "received": 7, "inserted": 7, "updated": 0, "duplicates": 0, "rejected": 0 },
  "normalization": {
    "vitals_upserted": 7,
    "nutrition_days_upserted": 1,
    "skipped_unapproved": 3,
    "invalid_records": 0,
    "invalid_by_type": {},
    "invalid_issues": [],
    "errors": []
  }
}
```

| Code | Meaning |
|---|---|
| 200 | Committed (including a valid no-op retry, which returns the original `ingest_id` with `status: "duplicate"`) |
| 400 | Malformed JSON or invalid envelope |
| 401 | Missing or invalid bearer token |
| 403 | Missing scope, no integration, paused/errored integration, or bad/missing signature |
| 413 | Payload too large |
| 429 | Rate limit exceeded |
| 500 | Transaction or internal failure — **nothing was committed** |

Raw persistence and normalization share one SQLite transaction, and the ingest
run row is written inside it. A 200 is never returned before the commit, so a
failed delivery leaves no trace and the companion's retry processes it normally
instead of being mistaken for an already-handled duplicate.

## Retention

- Canonical data (vitals, `nutrition_daily`) is kept indefinitely and is
  **never** deleted when an integration is removed.
- Raw records are kept while the integration exists. Deleting the integration
  asks whether to delete them too; keeping them orphans the rows (their
  `integration_id` becomes `NULL`) but retains the history under your user id.

## Troubleshooting

| Symptom | Cause |
|---|---|
| 403 `Missing X-Signature header` | No signing secret configured on the phone |
| 403 `Invalid X-Signature` | Wrong secret, or the secret was rotated and the phone not updated |
| 403 `No Health Connect integration exists` | The token's owner has not created one in Settings |
| 400 `source must be 'health_connect'` | The webhook was pointed at an iOS or screen-time payload |
| Deliveries arrive, nothing appears in charts | The integration is still in `inventory`, or the sending package is not approved. Check *skipped* in the delivery log |
