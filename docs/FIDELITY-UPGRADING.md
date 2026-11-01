# Fidelity alpha: upgrade and recovery

The next-release development identity is **2.1.0-alpha.1**. This document
supplements [UPGRADING](UPGRADING.md) and [NEXT-RELEASE](NEXT-RELEASE.md).
It does not announce publication, production readiness or a live deployment.

## Data and API compatibility

Migration `0017_fidelity_contracts` adds four tables: `clinical_records`,
`clinical_intake_batches`, `clinical_intake_items` and `body_scans`. It does not
rewrite existing clinical dates, numeric results, medication identifiers or
day-based vital identities. Historical receipt times remain unknown.

Typed corrections retain prior values and correction evidence. A legacy record
explicitly superseded by a typed correction is omitted from current numeric
projections. If the old editor changes that source later, the typed view exposes
both versions as a conflict. Exports retain labelled historical source values.
Untouched legacy records and default response shapes stay compatible.

Typed reads are opt-in with `format=typed`; dedicated clinical and scan routes
are described in OpenAPI. Existing PATs do not acquire new write capabilities:
`write:clinical_intake` stages self-subject previews only, and the owner approves
the exact reviewed batch in the app. `write:scans` is a separate explicit grant.
Neither is included in `write:all`. Existing device tokens and legacy ingestion
contracts retain their previous behavior. No new hard-delete API is provided.

Typed clinical imports persist created/corrected/linked/skipped/unresolved
outcomes. Retry the saved batch to read its durable result; do not treat a held
source row, partial preview or failed extraction as a completed import. Partial
dates are preserved as such. Generic lab document extraction is bounded and
does not establish full-history/page coverage; see the capability matrix.

## Before an authorized production upgrade

1. Record the actual running image ID/revision, complete container configuration,
   volume bindings and ingestion writers. Use the observed configuration, not
   a remembered tag. Obtain separate authorization for live changes.
2. Quiesce writers, stop the app and capture a consistent **whole data volume**:
   SQLite database plus any WAL, uploads and `keys/`. Keep encrypted secrets and
   their key files together. Preserve ownership and restricted access.
3. Retain the immutable compatible old image and configuration alongside that
   recovery copy. Verify archive hashes and available storage before upgrading.
4. Rehearse the exact candidate on an isolated copy, without provider/network
   access or production mounts. Verify migrations, original record identities
   and values, native-ingestion/idempotency state, encrypted-marker usability,
   original files, fresh setup and an idempotent restart.
5. Rehearse restore with the **old image and an untouched old-schema copy**.
   Never point an old image at the migrated database as a rollback strategy.
6. After the authorized change, verify real login, selected-person reads,
   representative intake/reload/export and current ingestion. Record the time
   at which new writes resumed.

If rollback is needed after new writes resume, preserve the new volume first
and reconcile later writes explicitly. Restoring the old snapshot blindly would
discard them. A healthy container alone is not workflow or restore acceptance.

## Verification boundary

The fidelity candidate requires exact-source synthetic full-app and recovery
evidence plus independent review. Mocked extraction verifies the application
pipeline; it does not certify provider accuracy. Android/device acceptance,
other-provider acceptance and older v2 release gates remain separate. Publication
and production rollout require their own reviewed action list and authorization.
