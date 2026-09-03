# Changelog

All notable changes to HealthTrack are documented here for GitHub releases.

## Unreleased

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
