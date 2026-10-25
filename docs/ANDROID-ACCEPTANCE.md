# Android companion: local acceptance and rollout

## Scope

This candidate adds the private Android companion and its server support to HealthTrack `2.0.0-rc.4`. Android sources are in `android/`; the server contract is in [ANDROID-CONTRACT.md](ANDROID-CONTRACT.md). The APK is a separate private artifact, excluded from the web container and Git. No Unraid deployment, phone installation, Google authorization, or publication was performed during implementation.

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

## Required phone acceptance

These checks require the intended Android 14+ phone and remain unverified:

1. Install the signed APK and open the configured HTTPS instance. Verify default-origin TWA behavior or the documented Custom Tab fallback; test email/password and, if configured, Google login in the system browser.
2. Pair the intended owner, explicitly choose offline people, and verify replacing a phone fences its old credential. Confirm browser profile selection never redirects native sync to another owner or dependent.
3. Grant selected Health Connect read permissions. Review exact source-package approvals and retain explicit Oura/Renpho/myAir preferences. Check foreground readings against the originating apps, including units, BP pairs, sleep coverage and overlapping activity totals.
4. Verify initial history coverage with and without history permission, later permission expansion, permission loss during a scan, edited/deleted records, interrupted scans, exact retries and server rate limiting. A partial or unauthorized scan must never infer missing-record deletions.
5. Run a 24-hour background-delivery trial under normal battery/network conditions. Android can delay WorkManager. Without background-read permission, verify foreground Sync Now and queued-delivery behavior.
6. Save each allowed person's matching JSON/PDF bundle. Test airplane-mode viewing after reboot, device authentication, the seven-day age warning, PDF sharing, account/server changes, local deletion and disconnect.
7. Revoke the phone while connected and while offline. Verify cached summaries and in-memory content are cleared on confirmed revocation/contact. An unreachable phone cannot be remotely erased immediately.

## Production upgrade and rollback gate

Local acceptance does not authorize deployment. Before a separately approved Unraid update:

1. Inspect and record the currently running image digest/revision, mounts, configuration and integration delivery paths. The running Unraid revision was not refreshed in this Android implementation task.
2. Capture a consistent SQLite backup and preserve the complete compatible `/data` state, including uploads and encryption/authentication keys, with the running image and configuration. Protect backups as health data and credentials.
3. Upgrade an isolated copy using the proposed image and exercise login, clinical records, imports, device pairing and sync. Then restore the old compatible image/data pair in isolation and exercise the same representative reads. Do not point the old image at a migrated production volume as a rollback shortcut.
4. Configure the correct HTTPS `APP_URL`, reporting timezone and public Android signing fingerprint. Keep existing provider credentials and explicit source preferences intact.
5. Deploy only after approval. Install/pair the APK, perform the physical-phone acceptance above, and verify browser-visible data from a real phone delivery.

For an operational return to the existing relay while retaining the new server, use Settings → Phone & sync → Return to legacy delivery. It revokes native credentials first, preserves imported records and does not rotate a shared relay token. A binary rollback instead uses the pre-upgrade compatible image/data/configuration pair; separately preserve any new records needed before restoring it.
