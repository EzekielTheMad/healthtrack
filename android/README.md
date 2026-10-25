# HealthTrack Android

Private Android 14+ companion. The default `https://omnihealthtracker.com` website opens in a browser-backed Trusted Web Activity when the browser verifies Digital Asset Links, otherwise a Custom Tab. The APK declares its app-to-site `asset_statements` relationship; the server must serve the matching site-to-app certificate relationship. Other configured HTTPS origins explicitly use Custom Tabs with visible browser controls. There is no WebView, cookie copying, or JavaScript health-data bridge.

Native screens provide HTTPS account pairing, selected read-only Health Connect permissions, foreground sync, best-effort 15-minute WorkManager scheduling, delivery status, and explicitly saved Doctor Essentials. Pairing approval occurs in the authenticated website; replacing an existing delivery phone is an explicit server action. Exported `healthtrack://sync` and `healthtrack://doctor` links only select a native screen.

## Build

Use JDK 17 and Android SDK platform 36/build tools 35.0.0. Set `ANDROID_HOME` or create ignored `local.properties` with the SDK location. On Windows escape a drive colon (`sdk.dir=C\:/Android/sdk`). The checked-in Gradle wrapper pins Gradle 8.13 and its distribution SHA-256. Dependencies use pinned stable releases.

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

For a signed private release, supply these environment variables from a credential store: `HEALTHTRACK_KEYSTORE` (absolute file path), `HEALTHTRACK_STORE_PASSWORD`, `HEALTHTRACK_KEY_ALIAS` (defaults to `healthtrack`), and `HEALTHTRACK_KEY_PASSWORD`. Do not place passwords in command arguments, Gradle properties, or this repository.

```powershell
.\gradlew.bat :app:assembleRelease :app:lintRelease
```

The APK is under `app/build/outputs/apk/release/`. Verify its signing certificate with Android `apksigner verify --print-certs`. Preserve an encrypted backup of the signing key and its recovery material: future APK updates must use the same certificate. Configure the matching package `com.omnihealthtracker.app` and public SHA-256 fingerprint in the server's Digital Asset Links configuration. An unconfigured origin still opens with visible browser controls.

## Data behavior

- Credentials and the exact serialized pending batch use an AES-GCM Android Keystore key without a device-unlock requirement so queued uploads can retry in the background. Files reside in `noBackupFilesDir`, with cloud backup and device transfer excluded. The outbox is bounded to 8 MiB; network failure stops further reading.
- Every batch has a generation, ordered sequence, UUID, and exact-byte HMAC. A matching accepted acknowledgment advances its cursor and sequence atomically in the encrypted state file. A lost acknowledgment retries the same body. Replaced/revoked devices cannot silently re-enroll.
- Scalar records retain Health Connect IDs, source packages, modification times, units, and paired blood pressure. Nutrition omits unknown macros. Sleep keeps unknown stages; the server determines supported coverage.
- Initial/expired-cursor scans acquire a fresh Changes token before reading. Deletion inference is limited to previously observed exact source packages inside a fully read, still-authorized window. New packages are delivered as upserts. Acknowledged 100-record SDK pages persist encrypted scan/pagination checkpoints, allowing interrupted and rate-limited scans to resume without rereading the whole history. Partial pages may be safely replayed; interrupted scans never complete or infer deletion. Scans older than 25 days or with changed coverage restart with a fresh anchor.
- History availability and completed backfill are separate. Adding history permission forces a 90-day rescan even when a 30-day Changes cursor already exists. Per-type coverage widens only with the final matching full-scan acknowledgment; advancing a cursor with restricted access lowers its proven coverage so regranting history triggers another full backfill. Base/history permissions are rechecked around each read and before scan completion; losing history abandons the 90-day scan without completing it or inferring deletions, allowing a new authorized 30-day scan.
- Activity uses Health Connect's aggregate API, with a complete 30/90-day window recomputed each successful sync. All four activity read permissions are required before refreshing totals, so partial permission loss cannot remove unread totals. No missing aggregate is converted to zero.
- Background Health Connect reads require the optional supported background permission. Without it, scheduled work can deliver an existing queued batch but does not read new records. Android may delay WorkManager jobs. **Sync Now** remains available.
- Doctor Essentials stores matching JSON/PDF together in one encrypted bundle, bound to instance/account/person/grant revision. A separate Keystore key requires a strong biometric or device credential. Capture age and original observation dates remain visible; copies warn after seven days. Background credential access cannot unlock clinical summaries.
- PDF sharing is explicit and uses a temporary read-only content URI. Temporary shared files are removed on return to the app. Disconnect clears local enrollment, queued uploads, and summaries; if server revocation cannot be confirmed, browser revocation is still required. Remote revocation cannot erase an unreachable phone immediately.

## Acceptance boundaries

JVM tests exercise actual SDK record mappings, PKCE/HMAC, batch acknowledgment/checkpoint behavior, byte limits, and cache identity/staleness. Android lint and APK compilation do not establish physical-phone behavior. Before normal use, verify Android/Google browser login, Health Connect consent and source approvals, sync/retry/deletion handling, device replacement, offline authenticated summaries after reboot, PDF sharing, and a 24-hour background-delivery window on the intended phone. Do not call the phone workflow verified until these checks pass.

Bulk document uploads/reconciliation, API credentials, raw inventory/reprocessing, full exports, and other advanced administration stay in the browser. Existing online clinical edits stay on the website; this release adds no offline clinical editing.

Platform references: [Health Connect 1.1](https://developer.android.com/jetpack/androidx/releases/health-connect), [Changes synchronization](https://developer.android.com/health-and-fitness/health-connect/sync-data), [Trusted Web Activities](https://developer.chrome.com/docs/android/trusted-web-activity), [AGP 8.11 compatibility](https://developer.android.com/build/releases/agp-8-11-0-release-notes).
