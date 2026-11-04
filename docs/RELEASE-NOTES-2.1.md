# HealthTrack 2.1.0 release notes — unpublished candidate

This web release combines the work since v0.8.1 with the previously unshipped v2
changes. It keeps Next.js, SQLite, a single application container and optional AI.
These notes do not announce a published image, GitHub release or deployment.

## Everyday workflows

- Edit medication start/end dates and preserve unknown dates, identifiers and
  dated active/inactive courses across history, exports and question context.
- Review repeated and overlapping lab/history imports with patient-scoped document
  identity, observation matching, explicit conflicts, durable item outcomes and
  retry protection. Corrections retain prior values and original documents.
- Read integration outcomes and freshness, choose overlapping metric sources, and
  distinguish missing data from recorded zero values. Measurements include dated
  left/right comparisons; weekly review shows averages with recorded-day coverage.
- Prepare patient-scoped doctor PDFs and use shared dated app/API context with
  provenance and coverage. Existing exercise alias/review tools remain available.

## Clinical reports and body scans

Owner-reviewed forms and typed JSON preserve encounters, sleep studies, aggregate
PAP windows, instrument-specific screenings, procedure events, condition history,
allergy review and qualitative genetics. Same-day repeats and uncertain source
evidence remain explicit. Aggregate reports are never expanded into daily readings.

Body scans preserve all 24 regional/specialized report metrics, raw units,
definitions, vendor evidence and compatible same-scan derived ratios. Normal forms
include timezone, exact workout time, supplement links and protected document/page
references. New report-write API grants do not widen historical tokens.

## API-key compatibility and upgrades

New malformed explicit expiries are rejected before key creation. Existing malformed
non-null expiries fail authentication; valid legacy dates and intentional no-expiry
keys retain their behavior. There is no automatic date rewrite, rotation or key
creation. An affected owner can explicitly replace/revoke that key and update its
client. The old API Access display may still show Active/Invalid Date; no new
minute-based expiry control is included. See [upgrade notes](UPGRADING.md).

Migration `0018_web_clinical_records` follows the account-AI/fidelity migrations.
Back up the complete stopped `/data`, matching keys/configuration and exact old
image before startup migrations. Rehearse upgrade and compatible restore in
isolation. Preserve and reconcile later writes before rollback; an old image must
use its matching old data. Existing integrations/API responses remain compatible;
new report writes require explicit grants.

The Docker build verifies known migration/journal inputs and produces a separate
runtime copy with pinned historical bytes, independent of checkout line endings.
Unknown contents fail the build. The source SQL and applied database ledger are
not rewritten; this adds no schema migration. Public CI and release builds use
the same rule.

## Verification and limits

The application code matches the local 2,116-test/226-file candidate. The added
migration-artifact rule passed ten focused tests and CLI checks, including exact
synthetic ledger hashes preserved across repeat migration runs. The combined full
suite has not been rerun solely for unchanged application files.
Retained synthetic browser/API/import/correction/PDF/isolation evidence and focused
expiry checks cover the applicable behavior. These are not clinical-accuracy
claims. Final corrected images, native architecture execution, recovery and
publication still need their exact release checks; see the
[candidate checklist](RELEASE-CHECKLIST.md).

Earlier real OpenAI text/PDF/image checks cover unchanged provider paths. Live
Anthropic/Gemini compatibility remains unverified; all three adapters and in-app
setup tests remain available. Oura permission/outcome/freshness acceptance is still
pending. Physical Android sync/offline acceptance is deferred and unverified, and
this web release includes no public APK. Vendor-specific parsers and automatic
clinical interpretation remain outside this release.
