# Changelog

All notable changes to HealthTrack are documented here for GitHub releases.

## 2.1.0-alpha.1 — next-release fidelity candidate (unpublished)

- Typed numeric, qualitative, censored and canceled labs retain source units,
  comparators, reference evidence, printed/derived flags and honest date precision.
- Structured medication/supplement courses separate strength, amount, prescribed
  directions, reported use and explicitly reported administration/missed/skip events.
- New clinical API intake stages an exact preview for owner approval in the app;
  corrections retain prior source values and audits. New grants are explicit;
  historical wildcard/device tokens cannot silently gain these write capabilities.
- Identified body scans retain same-day repeats, raw units, source/device/method
  and known conditions. Seven core mass/water/area metrics, manual/JSON entry,
  bounded typed metadata and source-aware comparisons preserve estimate labels.
- Context, doctor PDF inputs and owned exports retain typed evidence. Current
  numeric projections omit explicitly superseded legacy values with coverage
  warnings; changed records prevent stale cached/in-flight answers.
- Additive migration `0017_fidelity_contracts` preserves legacy records. Restore
  requires the matching pre-upgrade image/data/keys/configuration pair; preserve
  subsequent writes before rollback. See [next-release notes](docs/NEXT-RELEASE.md).

This is a local development candidate. Full-app/recovery/review evidence and
separate publication/deployment authorization are required; v2 gates remain open.

## 2.0.0 — release candidate (unpublished)

### Added

- Account-owned AI settings for direct Anthropic, OpenAI and Gemini APIs:
  encrypted write-only keys, model discovery, primary/document selections,
  explicit fictional connection tests, immediate settings changes and removal.
- Saved document review with patient-scoped hashes, observation reconciliation,
  explicit skip/add/link/correct choices, retained originals/provenance,
  honest partial dates and transactional retry protection. Standalone vaccine
  uploads use the same saved review instead of inventing missing dates.
- Doctor Essentials, collection-dated lab summaries and audited corrections;
  dedicated body measurements, aligned two-metric comparisons, guided mobile
  weekly reviews, nutrition coverage and exercise catalog/alias access.
- Consolidated integration status, Oura reconnect/sync actions and truthful
  partial/backoff/delivery freshness; shared dated app/PAT health context.
- Private Android website-first companion with optional native Health Connect
  delivery and offline essentials. APK/store publication is not part of v2.

### Fixed

- Editable medication dates preserve calendar days, unknown dates and identifiers.
  Profiles convert entered units before canonical validation; supported LAN HTTP
  and HTTPS sign-in retain their correct cookie behavior.
- Patient and AI configuration isolation, stale request fencing, strict
  interaction-output validation and withholding legacy potentially pooled AI
  results. Old clinical facts and source documents remain retained.
- Actual PDF/PNG/JPEG content determines extraction format. Overlapping activity
  totals are selected instead of added; missing CPAP nights remain unknown and
  recorded zeros remain zero. Instance timezone governs reporting windows.
- Active browser pages share the existing 15-minute inactivity deadline.
- Doctor PDF section headings use orphan protection while large rows can span pages. README screenshots
  use a newly generated fictional account; native AMD64/ARM64 CI smoke checks
  can run before publication.
- Next.js remains on 16.4.3; Better Auth is patched to 1.7.7. See release evidence
  for the remaining moderate development-tool advisories and their limits.

### Upgrade and verification

Back up the complete matching image/configuration and `/data` volume, including
keys and uploads. Startup applies additive migrations through
`0016_trusted_ai_context`. Stop old writers; do not mix versions. Configure AI
per account; environment keys no longer activate it silently. Legacy admin
migration is explicit. Rerun interaction checks after upgrading, and complete
the timezone/source preflight before ingestion or reprocessing.

See [v2 scope/evidence](docs/V2.md), [upgrade and rollback](docs/UPGRADING.md),
[AI setup](docs/AI.md), [candidate checkpoint](docs/RELEASE-CANDIDATE.md) and [release gates](docs/RELEASE.md). Real-provider
text/document acceptance, full physical-phone/background/offline acceptance,
advertised container architecture execution and publication must be recorded
for the exact candidate before a public release is claimed. This entry is a
release draft, not an announcement that those gates passed.

## 0.8.1 - 2026-09-03

### Fixed

- Built Oura authorization and token-exchange callback URIs from the public
  `APP_URL` instead of Next.js's reverse-proxy request origin, which could leak
  an internal address such as `http://0.0.0.0:3000` into the provider redirect.

## 0.8.0 - 2026-09-03

### Fixed

- Corrected Oura duration units to HealthTrack's canonical `min` unit so sleep,
  stress, and recovery vitals pass registry validation and persist.
- Persisted Oura resilience levels as ordinal vitals, including their canonical
  numeric value and label metadata.
- Stopped converting absent Oura `time_in_bed` and `latency` fields into false
  zero-value measurements.
- Made Oura calendar windows follow the validated IANA timezone in `TZ`, with
  the portable `Etc/UTC` default and correct behavior around UTC/DST boundaries.
- Prevented an all-endpoint fetch failure from advancing `last_sync_at`.
- Limited scheduled sync to active Oura connections, prevented overlapping
  runs, and surfaced isolated per-user and top-level scheduler errors.
- Serialized concurrent token refreshes per user and changed connection expiry
  so transient provider or local configuration failures remain retryable; only
  terminal refresh-token conditions expire a connection.

### Verification

- Added regression coverage for Oura mapping and persistence, missing optional
  fields, timezone boundaries, all-fetch failure handling, active-connection
  scheduler filtering, overlap/error behavior, and OAuth refresh
  concurrency/status transitions.
