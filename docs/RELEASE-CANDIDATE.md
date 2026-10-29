# v2 release candidate checkpoint

This is an unpublished `2.0.0-rc.6` checkpoint. It does not announce a public
v2 release or a new deployment. [V2](V2.md) owns scope and dated product
evidence; [release verification](RELEASE.md) owns the gates.

## Local release closure

The 2026-10-29 fictional-data drill exercised a fresh Linux/AMD64 container,
bootstrap and invite restrictions, both profile unit systems, LAN HTTP login,
all three account AI setup flows, query reuse, sign-out/sign-in persistence,
and the AI summary and interaction routes. Provider requests were intercepted
by a disposable test fixture; no real provider request or charge occurred.

Document checks covered visible PDF upload/review, original-file access,
repeated files, different enclosing documents, standalone labs followed by
overlapping history and the reverse order, separate owner/dependent hashes,
concurrent commits, PNG/JPEG content, invalid-file rejection, partial vaccine
dates, saved corrections and selected-person PDF downloads. These are fixture
workflow checks, not evidence of model extraction accuracy.

Container recreation preserved the complete test database, uploads and keys.
HTTP login and actual local TLS proxy login/reload passed with their intended
cookie policies. The TLS certificate was local and self-signed, accepted only
in the disposable browser; no public certificate or production proxy was tested.

An isolated image built from rc.5 source
`9290c6b1c2b358e69c417a181c8af719bbeab9b6` supplied the pre-upgrade schema.
The candidate upgrade/restart and separate matching old-image restore checked
all **55 prior tables / 545 prior columns**, typed values, row IDs and row
multiplicity. Nine native/mobile tables contained fictional state. Keys,
original files, decryption and SQLite integrity passed; the stopped master
remained unchanged. This is a local synthetic rehearsal, not a new backup of
the running installation or an off-host disaster-recovery test.

The baseline application checkpoint `cbd062e` passed **184 files / 1,819 tests**,
TypeScript and lint (0 errors, 15 advisories). Follow-up changes include PDF
orphan protection with oversized-row wrapping and discovery fencing before
every provider page request. Deferred-page tests cover draft removal,
replacement and expiry. The oversized fictional PDF spans six pages without
the prior unwrappable-row warning. Exact final commands, results, reviewer
readback and immutable source/image identities are retained by the operator
outside the public tree. Do not infer that a baseline result alone clears a
later changed candidate.

All six README screenshots were regenerated from the same disposable fictional
account. AI text/model names shown there are fixtures. No real account keys,
phone identifiers, patient records or production files supplied those images.

## GitHub reconciliation

Read-only comparison on 2026-10-29 observed public main `db80b11`, latest release
`v0.8.1` and the following open items. Their remote state has not been changed.

| Item | Candidate disposition and evidence limit |
| --- | --- |
| [#1 profile validation](https://github.com/EzekielTheMad/healthtrack/issues/1) | Unit conversion precedes canonical validation. Fresh imperial/metric save and reload passed locally. The reporter's installation has not been operated. |
| [#2 login](https://github.com/EzekielTheMad/healthtrack/issues/2) | Explicit `APP_URL` scheme determines cookie security. Fresh HTTP and local TLS-proxy browser login/reload passed. No claim about the reporter's host or Google consent. |
| [#6 document import](https://github.com/EzekielTheMad/healthtrack/issues/6) | Actual PDF/PNG/JPEG content reaches the correct adapter; account model discovery/testing and sanitized setup errors replace silent configuration assumptions. Fixture review/import passed. Real-provider document acceptance remains pending, so the original report is not declared universally resolved. |
| [#15 framework advisories](https://github.com/EzekielTheMad/healthtrack/issues/15) | Next.js is pinned to 16.4.3. The lockfile audit found no Next advisory at this checkpoint. Better Auth is pinned to 1.7.7; no high/critical audit findings remain. Four moderate Drizzle development-tool findings remain; no forced breaking downgrade was applied. Audit results are dated snapshots. |
| [PR #8 measurements](https://github.com/EzekielTheMad/healthtrack/pull/8), `00bb030` | Its measurement-view, bilateral/preset/delta and Weekly/context intent is selectively integrated. Current source selection, calendar and authorization services take precedence over the older branch. No branch merge is required. |
| [PR #13 interactions](https://github.com/EzekielTheMad/healthtrack/pull/13), `3b65193` | Selected exact-person input/output checks, strict malformed-output rejection, legacy trust markers, profile-lifetime guards and owner-only summary inputs. Migration numbering is adapted to v2 (`0016`), not copied over existing migrations. |
| [PR #14 summary/chat](https://github.com/EzekielTheMad/healthtrack/pull/14), `a6aa372` | This PR is stacked on #13. Selected owner summary/lab-dismissal isolation, legacy-output withholding and stale callback/cache protections. V2 retains its separately authorized dependent queries through shared scoped context; copying the PR's owner-only chat restriction would remove that behavior. Safe query metadata/fingerprints/configuration revisions replace unconditional legacy reuse. |
| [#5 translation](https://github.com/EzekielTheMad/healthtrack/issues/5) | Deferred; localization is outside this release closure. |

## Pending acceptance

- Real synthetic text, PDF and image requests for **each** direct AI provider,
  using separately authorized credentials/charges. Mocked plumbing is insufficient.
- All seven physical Android acceptance groups in [ANDROID-ACCEPTANCE](ANDROID-ACCEPTANCE.md),
  including enrollment, actual Health Connect delivery, offline/reboot/sharing,
  revocation and the real 24-hour background window. Historical bounded phone
  navigation checks remain valid only for their recorded APK/server pair.
- Owner/provider consent needed to resolve remaining Oura scope coverage, plus
  current provider delivery checks. A deployment does not grant consent.
- ARM64 application execution. A resource-bounded emulated build timed out after
  ten minutes; it is **not** a passing architecture check. Non-publishing CI now
  has native AMD64/ARM64 smoke jobs and an explicit runtime architecture check.
  Remote workflow execution has not been authorized or observed.
- Final exact-candidate independent review and any resulting corrections;
  approved external publication and readback. Live upgrade requires a fresh
  running-image/configuration inventory and compatible stopped backup/restore.

## External-action dry run

Nothing below is authorized by this document. Refresh remote state before an
approved action and bind it to the reviewed immutable commit/artifacts.

1. **Source review phase:** push only the reviewed `codex/healthtrack-v2` commit
   to `EzekielTheMad/healthtrack`; open one PR against current `main` with the
   candidate scope, migration warning, evidence and pending gates. This exposes
   the reviewed tracked source and fictional screenshots and runs PR CI, including
   two native container builds. Do not include local reporting, `tmpdata`, keys,
   volumes, private recovery bundles, signing material or APK files. No issue/PR
   comments, closures or old branch merges are bundled into this action.
2. **Acceptance phase:** authorize and complete the pending provider, phone,
   consent and architecture checks. CI dispatch is a separate remote action if
   the approved PR run does not supply the necessary native proof. Preserve
   failures and exact source/image/APK bindings.
3. **Final version/review phase:** once gates pass, prepare a `2.0.0` version
   checkpoint, refresh exact-source checks/review and the release-note draft.
   The current rc.6 source must not be labelled as a tested final `2.0.0` binary.
4. **Publication phase, separate approval:** merge the reviewed PR and create
   the exact approved `v2.0.0` tag. Every `v*` tag triggers native image builds,
   registry writes and mutable `latest` promotion. Record the AMD64/ARM64 and
   manifest digests, verify installation/visibility without authentication if
   intended, create the GitHub release using reviewed notes, and read back its
   source/tag/artifacts. Do not silently change package visibility or publish
   the private Android APK.
5. **Deployment phase, separate approval:** inventory the actual running image,
   configuration, free capacity and writers; rehearse compatible backup/restore;
   state the outage, exact image and rollback pair; then promote and verify the
   authorized instance. No live restart, cleanup, migration or bridge change is
   included in the source/publication phases.

The future final source/tag/digests remain unknown until their preceding gates
complete. The operator's concrete approval request must supply those identities
and the full action list; this checkpoint does not waive that requirement.
