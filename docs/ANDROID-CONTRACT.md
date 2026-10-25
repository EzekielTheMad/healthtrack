# Private Android companion

The Android companion uses the existing HealthTrack website for everyday work. Kotlin/Compose handles phone pairing, read-only Health Connect delivery, and encrypted offline Doctor Essentials. It does not embed login in a WebView. The shipped APK declares its association with the default `https://omnihealthtracker.com` origin and attempts a Trusted Web Activity there, with a Custom Tab fallback. Other configured HTTPS origins use Custom Tabs explicitly; a custom build can declare a different origin.

The private APK supports Android 14+. The package is `com.omnihealthtracker.app`. Each installation selects an HTTPS HealthTrack origin (default `https://omnihealthtracker.com`). The server must set `APP_URL` to that origin. LAN HTTP web login is unchanged, but the native companion requires HTTPS.

## Pairing and permissions

1. The phone generates a private PKCE verifier and posts `{device_name,code_challenge}` (S256/base64url) to `POST /api/mobile/pairing`. Response: `{request_id,verification_url,expires_at}`.
2. The system browser opens `/mobile/pair?request_id=...`. A signed-in owner approves replacing the active delivery path and explicitly chooses their own profile and/or owned dependents for offline summaries. Delegated households are excluded.
3. Browser `GET /api/mobile/pairing/{id}` returns status, account, device name, current delivery path, and eligible subjects. `POST .../approve` takes `{replace_existing,offline_subjects:["self", "dependent-id"]}` and requires the configured Origin.
4. The phone polls `POST .../redeem` with `{code_verifier}`. Pending is HTTP 202. Approval returns a dedicated PAT, per-device HMAC secret, immutable device generation, grant revision, subject grants, configured timezone and limits. Pair requests expire after five minutes and credentials can be redeemed once. A lost redemption response requires a new pairing.

Credentials never appear in browser URLs, logs, or the pairing approval response. The phone's PAT has `write:health_connect` and optional `read:doctor_summary`; the latter works only for a paired device and its live explicit subject grants. One owner and one active syncing phone are supported. Pairing another phone revokes only the previous phone's dedicated PAT. It does not rotate an existing relay's shared key or erase retained records.

`GET /api/mobile/devices`, `POST /api/mobile/devices/{id}/revoke`, and `POST /api/mobile/devices/restore-legacy` are owner-session endpoints. Browser mutations require a same-origin request. Revoking a phone keeps legacy delivery fenced until the owner explicitly restores it. Restoring the legacy relay revokes Android delivery first.

## Authenticated native interfaces

All responses with account, credential, grant or medical data use `Cache-Control: private, no-store`.

- `GET /api/v1/mobile/state`: Bearer PAT; returns device generation, grant revision, allowed subjects, limits, `native_last_sequence`, `next_sequence`, configured timezone, received/read timestamps, source approvals and integration status. Contains no credentials.
- `POST /api/v1/mobile/disconnect`: Bearer PAT; revokes the phone's dedicated credential.
- `POST /api/v1/mobile/health-connect/sync`: Bearer PAT plus `X-Signature: sha256=<hex HMAC-SHA256 of exact UTF-8 body>`.
- `GET /api/v1/mobile/doctor-summary?subject=self|dependent-id`: paired PAT plus summary scope/grant. Returns `{schema_version:1,subject,generated_at,fingerprint,grant_revision,summary}`.
- `GET /api/v1/mobile/doctor-summary/pdf?subject=...&fingerprint=...`: same authorization; PDF uses the same summary DTO and ETag. HTTP 409 requires refreshing JSON if data/grants changed. JSON/PDF are cached together on the phone only after both downloads succeed.

The device state and summary APIs revalidate ownership and revocation. Changing browser profiles never changes the phone's owner. Dependent deletion/transfer removes its offline grant on next contact. An offline device cannot be remotely erased; the app explains this limitation.

## Health Connect protocol 2

The executable wire schema is `src/lib/integrations/health-connect/native-schema.ts`. A body contains `protocol_version:2`, `device_generation`, positive sequential `sequence`, stable UUID `batch_id`, `read_at`, `app_version`, and `events`. Limits are 1 MiB and 500 records per transaction. The phone persists exact signed request bytes before sending and advances cursors only after acknowledgement. A retry of identical bytes returns the saved outcome; sequence conflicts or generation changes stop delivery for explicit recovery.

Events:

- `upsert`: `record` with record_type, exact source_package, record_id, start_time, optional end_time, source_modified_at, and data.
- `delete`: record_id, optional record_type/source_package. Deletes are owner-scoped audited tombstones, not guessed from an empty fetch.
- `daily_snapshot`: calendar date and replacement values `{steps?,distance_meters?,active_calories?,total_calories?}`. Omitted values are unknown and remove old native projections; they never become zero. Health Connect aggregates handle overlapping device totals.
- `rescan_begin`: explicit bounded scope `{scan_id,record_type,source_packages,start_time,end_time}`, `cursor_anchored:true`, `authorized:true`.
- `rescan_page`: scan_id, zero-based contiguous page and records.
- `rescan_complete`: scan_id, exact page_count, authorized:true. Only a complete authorized scan can infer deletions, only inside its window/type/packages. Acquire a Changes token before scanning and reconcile subsequent Changes.

Raw identities are owner/type/exact-package/Health Connect ID. Source modification timestamps prevent stale versions from overwriting current records. Each BP pair and intraday observation keeps its record ID. Data is retained raw before exact-package approval; normalization additionally requires enabled type and active integration. Source approval is separate from source preference. Direct Oura, Renpho and myAir preferences remain intact.

Scalar data uses `{value,unit}`; nutrition uses calories/protein_grams/carbs_grams/fat_grams, preserving missing fields. BP uses systolic/diastolic and mmHg. Sleep uses interval stages awake/sleeping/light/deep/rem/unknown/out_of_bed. Unsupported types remain outside this companion's permission scope. It requests no Health Connect write permissions and excludes generic heart-rate series.

## Presentation and offline boundaries

The mobile website uses Today, Health, Fitness, Nutrition, More. Daily clinical editing, vitals, measurements/comparison, workouts/goals/catalog, nutrition history, Query, notes and appointments remain available. Bulk document upload/reconciliation, raw inventories/reprocessing, token/HMAC management, sharing/delegates, broad export and destructive account administration use an explicit browser handoff with a validated selected subject. No missing subject falls back to the owner.

Browser handoffs also carry the originating `account_id`. Both the handoff page and destination validate it against the current authenticated account. Missing or mismatched accounts show sign-in/account-switch recovery while keeping clinical children unmounted; the selected subject and account survive login continuation.

`?app=android` is a display hint only. `healthtrack://sync` and `healthtrack://doctor` open native screens without credentials/clinical data in the link. Digital Asset Links at `/.well-known/assetlinks.json` is published only when valid `ANDROID_CERT_SHA256` fingerprints are configured; optional `ANDROID_APP_PACKAGE` defaults to the private package above. Domain verification is not a security credential.

The service worker caches only explicitly public assets. It never caches authenticated HTML, RSC payloads or API responses and does not replay old unscoped actions. Offline Doctor Essentials has separate device-unlock-protected encryption from background sync storage, no Android cloud backup, visible identity/captured time and a warning after seven days. Saving a summary does not imply the underlying feeds are current.

## Acceptance and rollout

Run server lint/tests/build, synthetic migrations/reconciliation, Android unit tests/lint/signed release build, and mobile checks at 375/390 pixels. Keep release signing material outside Git and preserve it for every update. No live installation, deployment or publication is implied by local build success.

After installation, verify pairing, source approval, initial history coverage, edits/deletions, revoked permissions, 24-hour background delivery under battery constraints, explicit foreground sync, browser subject handoffs and airplane-mode Doctor Essentials on a real phone. Fifteen-minute WorkManager delivery is best effort; without background-read permission sync requires opening the app. A production upgrade still requires a fresh compatible image/data backup and isolated restore/upgrade preflight.
