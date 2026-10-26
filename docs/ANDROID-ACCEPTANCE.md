# Android companion: local acceptance and rollout

## Scope

This candidate adds the private Android companion and its server support to HealthTrack `2.0.0-rc.4`. Android sources are in `android/`; the server contract is in [ANDROID-CONTRACT.md](ANDROID-CONTRACT.md). The APK is a separate private artifact, excluded from the web container and Git. Implementation, the subsequently authorized server deployment and a bounded physical-phone navigation review are recorded separately below. Full phone acceptance, provider-specific consent testing and publication remain outstanding.

The website remains the clinical record editor. Native features are account pairing, Health Connect delivery, permission/status controls, and explicitly saved offline Doctor Essentials. Bulk imports and administration use browser handoffs bound to both the originating account and selected person.

## Local verification

- Repository test suite: 174 files / 1,718 tests passed before the final targeted status and credential-display regressions. Subsequent focused results are recorded below.
- Final authorization, ingestion, status and UI regression run: 59 tests passed, including direct API-key revocation, exact native source provenance and the Phoenix midnight boundary. The last select-width adjustment passed its 10 component tests and scoped lint.
- Repository lint: zero errors; 16 existing warnings concerning form-library compiler compatibility, unused declarations and accessibility/navigation rules.
- Production build: Next.js standalone compilation and container build passed. Runtime data, secrets, Android toolchains and APKs are excluded from the image context.
- Synthetic rc3-to-rc4 database upgrade: medication dates and historical unknown receipt times remained unchanged. A pre-upgrade SQLite backup was restored to a separate file and queried with the rc3 schema. This is disposable fixture evidence, not a production restore or an older-image boot test.
- Local Docker Desktop container: fresh registration, secure HTTPS session cookie, profile completion, and anonymous denial on device/summary endpoints passed.
- Browser-to-server pairing: actual browser approval granted the synthetic owner and owned dependent. A signed native batch created three raw records; replay returned the identical saved outcome. Exact source approval exposed the retained records. The legacy webhook was fenced with HTTP 409.
- Operational fallback: restoring legacy delivery revoked the native credential and its summary access, retained clinical records and the separate shared relay credential, and kept mandatory HMAC verification. The phone-management response reflected the restored delivery mode and revoked phone.
- Doctor Essentials: owner/dependent medication separation, matching real PDF/JSON fingerprint, and foreign-subject denial passed through the running container. Repository tests cover corrections changing fingerprints, stale PDF requests, revocation, phone replacement and grant removal.
- Mobile browser: real Chromium checks at 375px and 390px cover five-tab navigation, Health, populated nutrition, phone settings, source approval, and account/person handoffs. Foreign accounts are rejected, and an expired cookie is cleared before login while preserving the intended account/person continuation. Synthetic screenshots and detailed results remain in ignored `tmpdata/android-preflight-private/`.
- Independent reviews covered server authorization, reconciliation, native sync checkpoints/revocation and mobile subject handling. Confirmed findings were corrected before final packaging.

The local HTTPS proxy used a disposable self-signed certificate trusted only by the test browser context. This does not establish Android TLS trust, domain verification or Google login behavior.

## Artifact and signing

The private artifact is `tmpdata/artifacts/healthtrack-android-beta.apk`; its checksum, signing certificate fingerprint, JVM test totals and build metadata are saved beside it in `healthtrack-android-beta.json`. Use the final artifact metadata, not an earlier build's checksum.

Final local artifact: 27,400,881 bytes; SHA-256 `08ac9b14b120726bc5a2222fbd21a6a72e8494aa370c9caac2c363faae8b49ef`. All 30 Android JVM tests passed. Debug and release lint each reported zero errors and 16 dependency/target/KTX suggestions. The signed release build and independent APK signature verification passed. Physical-device behavior remains subject to the checks below.

The disposable container, HTTPS proxy and test browsers were stopped after verification. The Android build's task-owned Java helpers also exited; task ports 3117/3118 were confirmed closed. The local image `healthtrack:android-local-preflight` and ignored synthetic evidence remain available for review.

The signing identity is outside Git under the current Windows user's protected LocalAppData directory. Future updates must keep the same signing key and increment the Android version code. Preserve the key and recoverable signing credentials in an encrypted backup. A Windows DPAPI credential file alone is not a portable recovery backup for a different Windows installation. Never copy signing passwords into repository files, build arguments, logs or command history.

The server's optional `ANDROID_CERT_SHA256` setting accepts the public release certificate fingerprint. Its value is public identity metadata, not a credential. The private key and password are never server configuration. See `android/README.md` for build and signing instructions.

## Authorized Unraid deployment — 2026-10-25

The server rollout completed at 18:59 UTC (11:59 America/Phoenix). Independent
read-back at 18:59:42 UTC confirmed **2.0.0-rc.4**, source
`e2551523bac67ec4397c0c21b73435d587d1d0ab`, Linux/amd64 image configuration
`sha256:8e6ccfa7dd8d48c1510fe643384ef6caff729476db7e3a8dfa2ee8bbdb6b9304`.
This was a private local image promotion; no GitHub or registry publication occurred.

- A fresh full stopped snapshot retains the compatible rc.3 image, effective
  configuration, applied template, uploads and keys. An isolated copy upgraded
  from 13 to 15 migrations and passed restart checks; another copy booted the
  exact old image successfully. The master snapshot remained untouched.
- Before public writes resumed, comparisons preserved every original row across
  46 tables and 474 columns, including nullable historical migration IDs. The
  only added original-table column was nullable native identity; the nine new
  native tables remained empty. Existing encrypted values authenticated with
  the preserved key. All 24 non-database files remained identical.
- The normal-entrypoint synthetic drill also exercised password/session login,
  owner/dependent clinical separation, original-document access, native pairing,
  signed delivery/retry, Doctor Essentials and revocation, followed by an exact
  rc.3 image/data restore. Real-account login and provider consent were not used
  as unattended deployment probes.
- Final independent verification passed all 33 checks: healthy revision, SQLite
  integrity/schema, only intended configuration/template changes, unchanged
  autostart, and the same running Renpho/myAir bridge identities/configuration.
  Task-owned build, synthetic, stage and restore containers and runners exited.
- Public HTTPS health/login returned 200. Tested clinical, native sync, summary
  and device routes rejected anonymous access with 401. Asset Links returned
  200 without redirection and matched the signed APK's package and certificate.

An initial attempt stopped safely before production migration because the
deployment verifier assumed non-null migration IDs. Recovery resumed rc.3 and
both bridges. The verifier was corrected and exercised on the isolated real-data
copies; 41 recovery fault scenarios and 58 preservation tests passed before the
fresh successful retry. Protected locations and detailed sanitized evidence are
retained under ignored `tmpdata/android-release/`, including
`final-audit-results.json` and `copied-data-diagnostic.json`.

The server is ready for the phone acceptance below. Deployment does not pair a
phone or switch delivery mode: the existing relay remains active until the
owner explicitly approves native pairing. This closes the server deployment
gate only. See [the rc.4 recovery point](UPGRADING.md#rc4-android-compatibility-and-recovery-point)
before any binary rollback.

## Physical-phone navigation review — 2026-10-26

The owner authorized USB debugging on a spare Samsung SM-S906U running Android
14/API 34 with a 1080×2340 display. The existing signed APK (version 0.1.0,
version code 1, checksum above) installed successfully. The owner completed
website sign-in on the phone; the subsequent dashboard, Health, Settings and
Doctor screens were exercised without editing records, pairing the phone or
starting native sync. Native screen protection remained enabled. Sanitized UI
observations and a website Health-menu screenshot are retained in ignored
`tmpdata/android-device-ux/`; no authentication material or clinical values were
retained in those observations.

The walkthrough confirmed these usability failures:

- Cold launch shows a native **Everyday health** launcher with four tabs.
  Choosing a destination then opens the website, which has its own five-tab
  navigation. The website rendered fullscreen on this phone without a browser
  toolbar; that observation alone is not a separate domain-verification audit.
- Back from the website exposes the native launcher again. Opening the native
  **Doctor Essentials · online and saved** action instead presents an offline
  pairing requirement, rather than the normal online doctor summary.
- From the website's Doctor page, **Open saved Doctor Essentials** opens that
  native screen. In this tested sequence, Android Back then exposed the
  previously open Android Settings app, rather than the originating website
  page. Reopening HealthTrack returned to native Home. This records the observed
  device behavior; the underlying task-stack cause was not established.
- Website Settings in Android mode replaces API access with an extra browser
  handoff. Following it makes the normal API controls available; Back returns
  to the interstitial. No token was created or revoked.

The incorrect native source-settings URL remains a static finding: it sends
`section=integrations`, while the website resolves `tab=integrations`. The wrong
Profile destination was previously reproduced in a browser. The paired-only
native button was not exercised on this unpaired spare phone.

The recommended correction is to use the existing mobile website as the normal
entry and sole online navigation, with native sync/offline actions returning to
the originating web page. This review changed no application behavior and does
not close the remaining Health Connect, offline authentication, replacement,
revocation or 24-hour background-delivery gates.

## Required phone acceptance

These checks require the intended Android 14+ phone. Only the bounded install,
sign-in and navigation observations above have been performed; full acceptance
remains outstanding:

1. Install the signed APK and open the configured HTTPS instance. Verify default-origin TWA behavior or the documented Custom Tab fallback; test email/password and, if configured, Google login in the system browser.
2. Pair the intended owner, explicitly choose offline people, and verify replacing a phone fences its old credential. Confirm browser profile selection never redirects native sync to another owner or dependent.
3. Grant selected Health Connect read permissions. Review exact source-package approvals and retain explicit Oura/Renpho/myAir preferences. Check foreground readings against the originating apps, including units, BP pairs, sleep coverage and overlapping activity totals.
4. Verify initial history coverage with and without history permission, later permission expansion, permission loss during a scan, edited/deleted records, interrupted scans, exact retries and server rate limiting. A partial or unauthorized scan must never infer missing-record deletions.
5. Run a 24-hour background-delivery trial under normal battery/network conditions. Android can delay WorkManager. Without background-read permission, verify foreground Sync Now and queued-delivery behavior.
6. Save each allowed person's matching JSON/PDF bundle. Test airplane-mode viewing after reboot, device authentication, the seven-day age warning, PDF sharing, account/server changes, local deletion and disconnect.
7. Revoke the phone while connected and while offline. Verify cached summaries and in-memory content are cleared on confirmed revocation/contact. An unreachable phone cannot be remotely erased immediately.

## Production upgrade and rollback gate

Local acceptance does not authorize deployment. Before a separately approved Unraid update:

1. Inspect and record the currently running image digest/revision, mounts, configuration and integration delivery paths. Refresh these for every deployment; the completed rollout above records its own observation time.
2. Capture a consistent SQLite backup and preserve the complete compatible `/data` state, including uploads and encryption/authentication keys, with the running image and configuration. Protect backups as health data and credentials.
3. Upgrade an isolated copy using the proposed image and exercise login, clinical records, imports, device pairing and sync. Then restore the old compatible image/data pair in isolation and exercise the same representative reads. Do not point the old image at a migrated production volume as a rollback shortcut.
4. Configure the correct HTTPS `APP_URL`, reporting timezone and public Android signing fingerprint. Keep existing provider credentials and explicit source preferences intact.
5. Deploy only after approval. Install/pair the APK, perform the physical-phone acceptance above, and verify browser-visible data from a real phone delivery.

For an operational return to the existing relay while retaining the new server, use Settings → Phone & sync → Return to legacy delivery. It revokes native credentials first, preserves imported records and does not rotate a shared relay token. A binary rollback instead uses the pre-upgrade compatible image/data/configuration pair; separately preserve any new records needed before restoring it.
