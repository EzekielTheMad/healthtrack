# HealthTrack 2.1.0 candidate verification

This checklist describes an unpublished web candidate. Scope is in
[web completion](WEB-COMPLETION.md), [fidelity](NEXT-RELEASE.md) and
[release notes](RELEASE-NOTES-2.1.md). Publication, image promotion and deployment
are separate decisions. Instance addresses, credentials, health records and private
operational receipts belong outside the repository.

## Completed evidence and limits

| Area | Recorded evidence | Boundary |
| --- | --- | --- |
| Corrected product source | 2,116 tests in 226 tracked files; focused expiry regressions; zero lint errors and 15 warnings in unchanged paths; earlier successful full TypeScript checking matches unchanged file hashes. | The public candidate keeps identical product code. These checks do not establish a new container image. |
| Records, imports and summaries | Retained synthetic browser/API/save/reload/import/correction/export/doctor-PDF checks and independent review. | Evidence belongs to the code and fixtures exercised; no claim of clinical extraction accuracy. |
| Calculations and access | Retained missing/zero, calendar/source, owner/dependent/delegate/API isolation and review-before-write checks; live valid-key empty read and broader-scope denial; fresh persisted Revoked UI after explicit owner cleanup. | The production post-revocation bearer 401 and live expiry denial were not executed. The closed partial run is not relabeled as a complete API probe. |
| Optional AI | All three adapters have fixture/setup/security coverage; earlier real OpenAI text/PDF/image requests cover unchanged provider paths. | Live Anthropic/Gemini compatibility and a current model catalog remain unverified. No extraction-accuracy claim. |
| Prior builds and recovery | Earlier native AMD64/ARM64 and isolated upgrade/restore evidence is retained. | Earlier results are not tests of the corrected binary. |

## Remaining release checks

- Complete the remaining Oura permission/outcome/freshness observations without
  treating Connected, a receipt timestamp or an empty fetch as a new measurement.
  Record unknowns and any specific consent/delivery gap; no unavailable formal
  grant-list requirement is invented.
- Review the exact public source/history/documents for private material. Bind
  builds to that source and execute the existing lint/test/build and native
  AMD64/ARM64 container gates for the final candidate where required.
- Test fresh setup/security and isolated upgrade/restart/compatible restore for
  the exact images. Retain the matching old image/data/keys/configuration and
  reconcile later writes before rollback. See [release](RELEASE.md) and
  [upgrade](UPGRADING.md) procedures.
- After separate publication authorization, record exact source/tag/manifest and
  platform digests, confirm intended package visibility and published readback.
  Deployment requires its own target-specific preflight and authorization.

Physical Android acceptance remains deferred/unverified outside this web release;
no public APK is included. Keep that limit explicit in any eventual release.
