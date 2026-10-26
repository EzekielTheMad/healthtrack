# Upgrade and rollback preflight

An upgrade applies migrations automatically at container startup. Keep the old
image **and its pre-upgrade data** together. Starting an old image against an
already migrated database is not the rollback procedure.

This checklist does not authorize publication, an outage, or a deployment.
Use [RELEASE.md](RELEASE.md) for release gates and [UNRAID.md](UNRAID.md) for
applied-template handling. Store instance-specific evidence outside Git.

## rc.5 inactivity correction recovery point

The separately authorized correction deployed on 2026-10-26 at 18:50:58 UTC,
source `9290c6b1c2b358e69c417a181c8af719bbeab9b6`, image configuration
`sha256:30ca829dc2827d16169aa1b11609139e115fa724aa30a760b5d1519f39b609cb`.
It retains version 2.0.0-rc.5 and the existing 15-minute inactivity rule while
coordinating activity across browser/TWA documents. There is no migration,
server API change, provider change or new APK.

A new writer-paused complete recovery bundle pairs the current data, keys,
original files and configuration with the exact prior rc.5 binary, source
`48f99c8e32fbece39e6533ee4e079fdeb72cf165`, image configuration
`sha256:e0e501fb36ca5dfac9030fa66f46626cfe69e67126b6d235e4477e798422f6d5`.
Private paths and verification reports are retained under ignored
`tmpdata/idle-logout/`. Separate candidate/restart and exact-old-image copies
passed full 55-table/545-column, typed-value/rowid/multiplicity/native-state,
15-migration, encryption/key/original and immutable-master checks. The independent
live audit passed 39/39. Provider configuration, bridge identities, Android
identity and autostart remain unchanged.

Only the approved unused rc.2 cached image was removed for space; its verified
archive and historical recovery material remain intact. The immediate rc.5
rollback image remains available. Public writes have resumed: preserve the
current complete volume and reconcile later records before any rollback. Do
not automatically overwrite new writes with this snapshot. Returning to the
previous binary also restores its per-document idle-timer behavior.

Reload existing website/app documents after promotion so they stop running the
old timer. Same-host restore evidence does not establish off-host recovery.

## rc.5 website-first Android recovery point

The authorized private website-first rollout completed on 2026-10-26 at
17:38:16 UTC, running **2.0.0-rc.5**, source
`48f99c8e32fbece39e6533ee4e079fdeb72cf165`, Linux/amd64 image configuration
`sha256:e0e501fb36ca5dfac9030fa66f46626cfe69e67126b6d235e4477e798422f6d5`.
It adds no migration: the schema remains 15 migrations, 55 tables and 128
noninternal objects. GitHub and registry publication were not performed.

A fresh writer-paused full recovery bundle retains all 27 files, keys, uploads,
effective configuration, applied template and the matching **rc.4** image,
source `e2551523bac67ec4397c0c21b73435d587d1d0ab`, image configuration
`sha256:8e6ccfa7dd8d48c1510fe643384ef6caff729476db7e3a8dfa2ee8bbdb6b9304`.
Exact host paths and sanitized checks are recorded privately under ignored
`tmpdata/seamless-rollout/`. Bundle/configuration parents are 0700 and sensitive
configuration files are 0600. The old image archive and all 13 layers verified.

Both candidate startup/restart and exact-old-image restore passed on separate
copies with no external network, ports or provider credentials. All original
55 tables/545 columns, typed values, hidden rowids, multiplicity, native/mobile
records, nullable migration identities and sequences were checked without
assuming native tables were empty. Keys, originals, encrypted-value usability,
SQLite integrity and the immutable master snapshot passed. See
[rollout evidence](ANDROID-ACCEPTANCE.md#authorized-website-first-rollout--2026-10-26).

Only the application image/revision/version labels and corresponding template
values changed. Android identity, providers, autostart and both bridge
configurations were preserved. Existing native pairing and delivery state remain
intact; this update does not require re-enrollment. The prior stopped container
was removed after its complete compatible recovery pair was retained.

Public writes have resumed. Any rollback requires a new writer pause and
preservation of the current full volume before deciding how to reconcile later
records and phone activity. Never automatically overwrite new writes with this
snapshot. A binary-only downgrade still requires separate behavior-compatibility
verification, even when schemas match.
Use the recorded matching image/data/configuration pair for snapshot recovery.
This is same-host rollback evidence; off-host disaster recovery is unverified.

## rc.4 Android compatibility and recovery point

The authorized private Android server rollout completed on 2026-10-25 at
18:59 UTC. Independent verification at 18:59:42 UTC confirmed **2.0.0-rc.4**,
source `e2551523bac67ec4397c0c21b73435d587d1d0ab`, Linux/amd64 image configuration
`sha256:8e6ccfa7dd8d48c1510fe643384ef6caff729476db7e3a8dfa2ee8bbdb6b9304`.
No GitHub or registry publication occurred.

The fresh full stopped recovery bundle, exact host paths and verification
evidence are recorded privately under ignored `tmpdata/android-release/`.
Its matching old binary is **rc.3**, source
`dd2241488908fe9c23316e8463b41e0c25fc7249`, image configuration
`sha256:d591bd6211b3d6cf12ecfd13641e9eb0e6625a8dc87197b6fcb90d20b5b78201`.
The archive's image configuration and all 13 layer hashes verified; the old
image, full data volume, effective configuration, applied template and keys are
retained together. Bundle/configuration parents are 0700 and sensitive
configuration files are 0600.

This release adds two migrations (13 → 15), nine native-delivery tables and
nullable `vitals.native_record_id`, with changed partial indexes. Do not boot
rc.3 against the upgraded volume. Both an rc.4 upgrade/restart of a separate
real-data copy and an exact rc.3 restore on another copy passed with networking
disabled, no published ports and provider environment credentials omitted.
Before the production write boundary, all original rows in 46 tables/474
columns, migration identities, encrypted-value usability, keys and original
files passed preservation checks. Nullable Drizzle ledger IDs were preserved;
the verifier uses row identity rather than assuming numbered migration IDs.
The independent final audit confirmed the master snapshot was untouched.

The live application preserves its port, mount, network, restart policy,
timezone, signup behavior and provider credentials. The applied template changes
only image/revision and the public Android package/certificate settings.
Autostart and both existing bridge identities/configuration remain unchanged.
Native pairing is an owner action; upgrading alone leaves the legacy delivery
path active. See [Android acceptance](ANDROID-ACCEPTANCE.md#authorized-unraid-deployment--2026-10-25)
for evidence and the unverified physical-phone workflows.

Public writes resumed after validation. A binary rollback requires a new writer
pause and preservation of the current complete volume, then restoration of the
matching rc.3 image/data/configuration pair. Preserve or reconcile records and
phone enrollment written since deployment before reverting; do not silently
discard them or point the old binary at rc.4 data. To return only to the relay
while retaining rc.4 and its records, use Settings → Phone & sync → Return to
legacy delivery. Same-host recovery is verified; off-host recovery remains
unverified.

## rc.3 compatibility and recovery point

The separately authorized comparison and Oura permission-review rollout was
observed healthy on 2026-10-25 at 05:23 UTC (2026-10-24 22:23 America/Phoenix).
Production ran **2.0.0-rc.3**, source
`dd2241488908fe9c23316e8463b41e0c25fc7249`, Linux/amd64 image configuration
`sha256:d591bd6211b3d6cf12ecfd13641e9eb0e6625a8dc87197b6fcb90d20b5b78201`.
No migration was added. This was local image promotion, with no GitHub or
registry publication.

The protected full stopped recovery bundle and exact host paths are recorded
in the private release report under ignored `tmpdata/comparisons-and-integrations/`.
Bundle and configuration directories are mode 0700; sensitive configuration
files remain private.
Its matching old binary is **rc.2**, source
`abd78eaa5ecef462ecb02e9c5fa3f9d8592f1084`, image configuration
`sha256:452d5e9a00f0eb9085650256898aa0f7e4a9c6a6d4d2037ed525f576c4161aa8`.
The old image, effective configuration and complete stopped data were preserved
together. The exact old binary booted a separate offline restored copy, and
candidate preservation checks passed for all 46 tables, 474 columns, the
unchanged 13 migrations, keys, original files and encrypted-value usability.
Final read-back confirmed healthy application identity, preserved runtime
configuration/mounts, an untouched master snapshot and no remaining helper
containers or deployment runner. Public login/anonymous denial checks passed.

The existing Renpho/myAir bridges initially resumed unchanged; their subsequent
scoped repairs passed the separate checks below. Real-account Compare use and
additional Oura consent were not performed during the application promotion.
The disposable browser checks already covered `/vitals?view=compare` at phone
and desktop widths. For production user acceptance, verify the intended person:
30/90-day windows, independently labeled axes, visible sources, recorded-day
coverage, a true zero and an unrecorded-day gap. Dependent/delegate comparisons
must report nutrition and fitness unavailable. The session-only
`/api/metric-comparison` route must reject anonymous and PAT-only requests.
Existing `/api/v1` APIs and token scopes remain unchanged.

New Oura authorization requests add `stress` for Resilience. Existing saved
credentials and grants are preserved; an upgrade cannot add provider consent.
The owner may select **Review Oura permissions** and choose permissions on
Oura's consent screen. Do not interpret missing Resilience access as expired
authorization when other feeds remain usable. Confirm those feeds retain
active/partial status while permission review is outstanding, and distinguish
a genuine expired grant from a collection-level permission denial. Do not
complete the owner's consent as part of an unattended upgrade check.

This snapshot predates post-promotion production writes. A rollback requires
pausing writers, preserving the current full volume and using this bundle's
matching rc.2 image/configuration/data pair. Do not silently discard new writes
or substitute an older rc.1/v0.8.1 recovery point. The bundle supports same-host
rollback; off-host recovery remains unverified. See [the deployment evidence](V2.md#comparisons-and-oura-permission-review-200-rc3).

### Bridge repair compatibility and recovery

Final bridge read-back passed on 2026-10-25 at 05:40 UTC with the application
unchanged and healthy. Runtime credentials, Config/HostConfig and network
aliases were preserved for each bridge. Compose pins the verified patched
images and removes only the original `build: .` line; host source files remain.
Apply the reviewed patches before any later source rebuild or image
replacement, or the original integration defects can return.

Renpho's corrected protocol headers passed a real provider login and normal
ten-day body/tape poll without errors. There were no eligible recent records:
`success_no_recent_data` confirms the upstream poll, not a fresh HealthTrack
receipt. Do not widen the backfill window or repost historical observations to
manufacture receipt freshness. myAir's live gate confirmed a received
provider-dated zero-use observation without newly posted AHI/leak/score;
unknown usage remains unknown and previous records remain intact.

Each bridge has its own private compatible old-image/configuration archive and
retained stopped old container. Exact recovery locations and sanitized
acceptance/retry evidence are in the ignored release report and
`tmpdata/comparisons-and-integrations/post-bridge-audit.json`. A bridge-only
failure calls for restoring that bridge's original container and startup image
configuration. Preserve the running application and its current clinical data;
do not restore the application database as part of bridge rollback.

These bridge changes add no grant for Oura's `stress` permission and cannot
trigger the companion phone's Health Connect delivery. Those remain user
actions. No GitHub or registry publication was performed.

## Before a maintenance window

Record the running platform, source revision, immutable image/platform digest,
all mounts, port mappings, network, restart/autostart settings, effective
non-secret configuration, secret *presence*, and the applied template's hash.
Compare configured secret values internally if necessary; never print them.
Preserve the actual applied template, rather than replacing it with repository
defaults. In particular, preserve `APP_URL`, timezone, signup policy and key
overrides. Check both current values and template defaults.

Check SQLite integrity and migration history read-only. Compare historical
migrations and the old image's schema with the proposed candidate. Identify
scheduled sync, phone delivery, bridges, API clients and manual entry as writers.
Confirm real backing-pool capacity and UID/GID, rather than relying only on a
user share's aggregate free space. The full data tree can contain sensitive
retired integration configuration as well as records and keys.

Check the Docker root filesystem separately from the data volume. Loading an
image, temporary export layers, container logs and writable layers use Docker's
storage even when `/data` has ample capacity. If export scratch is insufficient,
reuse a protected old-image archive only after verifying its whole-file hash,
configuration identity and layer hashes. Do not prune unrelated resources to
make a deployment fit. An unset historical `OomKillDisable` and Docker's returned
`false` both leave the normal OOM killer enabled; a configuration comparison
may normalize that one default while still checking all other fields exactly.

Rehearse using the exact old image and the candidate, synthetic records and
disposable directories:

1. Block egress and publish no ports. Boot the old image normally, create a
   password account, sign in, and create representative owner/dependent records.
2. Stop it and copy the **complete** data tree to a separate backup directory.
   Verify a file manifest, including keys and original documents.
3. Start the candidate normally against a separate copy. Check migration count,
   integrity, authentication/session persistence, record IDs, dates, patient
   scoping, original downloads and decryption of a synthetic ciphertext. Restart
   once and confirm migrations and records are unchanged.
4. Restore the untouched backup into another empty directory and boot the exact
   old image. Check sign-in, records, original documents and encryption again.
5. Remove only identified disposable containers. Retain sanitized evidence.

This proves compatibility for the tested fixtures and platform. It does not
replace the real snapshot/restore gate below, provider UAT or an ARM64 test.

## Approved maintenance window

Prepare a complete dry-run list with exact container names, source/destination
paths and image digests before operating on the instance. Preserve the original
configuration securely; Docker inspection and applied XML can contain secrets.

1. Pause external writers and access, then stop the application. Include direct
   LAN bridges as well as public API clients. Confirm there are no remaining
   processes using the volume before copying. For an actual promotion, keep
   writers paused throughout candidate verification so queued retries cannot
   modify its state unexpectedly. For a snapshot-only rehearsal, resume the
   unchanged old application and bridges after the stopped copy has been
   verified, then test the frozen restore offline. That snapshot becomes stale
   when production writes resume; take another immediately before promotion.
2. Make a new, access-restricted backup destination **outside `/data` and its
   source directory**. Copy the entire stopped tree with ownership, modes and
   timestamps, including SQLite sidecars if present, uploads, keys and other
   persistent files. Preserve the effective configuration/applied template and
   an export of the old image, or verify it can be acquired by immutable digest.
   A database-only backup is insufficient. Never back up a directory into itself
   or overwrite the only pre-upgrade copy.
3. Verify the complete file manifest. Keep the master snapshot untouched; run
   SQLite integrity checks on a separate verification copy. Restore into a new
   directory with the same ownership and permissions. Boot the old
   image there with **no network, no published ports and no integration egress**.
   Omit provider environment credentials and set `OURA_SYNC_ENABLED=false` in
   this disposable restore; preserve authentication/encryption key overrides.
   Verify health, schema, keys, original files and a representative authenticated
   workflow using the operator's existing password/session supplied privately
   if available. Google-only OAuth cannot sign in without egress; record that
   limitation instead of enabling network access or resetting credentials.
   Do not expose credentials in command arguments or evidence. Remove only this
   disposable container after stopping it. Keep the untouched snapshot.
4. Promote only the separately approved candidate digest. Keep incoming delivery
   and scheduled sync paused for the initial smoke check. If sync configuration
   is temporarily overridden, record that change and restore the intended
   configuration explicitly. Do not attach a health-data copy to an ordinary
   network merely to test it.
5. Read back the new running image and revision, health and migration state.
   Verify HTTPS/HTTP cookies at the configured browser-facing origin, existing
   login, owner/dependent scope, medication date editing, original downloads,
   lab review and API/PAT compatibility. Confirm signup remains invite-only if
   that is the intended policy. Resume writers deliberately and check receipt
   freshness and truthful integration outcomes.

The operational recovery point is the stopped snapshot. Writes made after
cutover are absent from it. If rollback is needed, pause writers again, stop the
candidate, and preserve the failed candidate volume separately for diagnosis.
Restore the original snapshot into a **new** directory, verify its manifest and
ownership, then run the recorded old immutable image with the recorded old
configuration against that restored directory. Verify login, records and files
before reopening access and resuming writers. Do not merge migrated SQLite
files into the old snapshot or restore only the database without its keys and
uploads.

Keep a second protected copy on another failure domain for disaster recovery.
A same-host snapshot supports rollback but does not establish off-host recovery.

## v0.8.1 to v2 compatibility evidence

On 2026-10-23, read-only inspection confirmed the target instance was running
v0.8.1, revision `ed0d1f2edf5993637ee3abda10be66287536fbee`, Linux/amd64.
Its immutable image digest was
`ghcr.io/ezekielthemad/healthtrack@sha256:d54c013c48fa7906bc8d905029b141b6f73470ae0a710b41d54dd319707337dc`.
The ten recorded migrations matched that image and the candidate's historical
SQL, and the 104-object schema fingerprint matched the exact old-image fixture.
The exact old-image → candidate → restored old-image rehearsal passed with
synthetic records, including password/session authentication, application
decryption, patient scoping, original files and restart idempotence; see
[V2.md](V2.md#exact-running-image-preflight-2026-10-23).
The candidate adds three migrations. Live SQLite `quick_check` returned
`ok`. The application ran
as UID 99/GID 100, and safe runtime values and configured-secret equality agreed
with the applied template. Public TLS validated, health returned 200 and both
medication API authentication probes returned 401.

Existing backup files included two old SQLite files and four other files, with
no verified current full-volume/key/upload coverage. They are not an acceptable
rollback snapshot. That initial inspection made no live changes.

### Approved real-volume snapshot and restore

The operator subsequently authorized the snapshot-only maintenance window on
2026-10-23. Only the application and its two bridges stopped; the unchanged
v0.8.1 application resumed before offline restore verification. The stop/copy/
resume interval was 97 seconds, including bridge shutdown time.

The protected same-host snapshot contains all 27 files (116,111,191 bytes),
including both generated keys and all 15 original PDFs. Source and backup
matched byte hashes, ownership, modes and timestamps. Effective configuration,
applied XML and an old-image archive were preserved privately; archive config
and all 13 layer hashes verified. Backup/configuration parents are root-owned
0700 and sensitive configuration files are 0600.

A separate restored copy booted the exact old image on Unraid with networking
disabled, no published ports, no provider environment credentials and Oura
scheduling disabled. SQLite integrity, ten historical migrations, 104-object
schema fingerprint and aggregate table-record counts matched before/after
startup. All three saved encrypted integration values authenticated with the
restored key using offline AES-GCM; this does not prove provider token validity.
Keys and original files matched, and the master snapshot remained untouched.
No actual password/session was supplied, so real-account sign-in was not tested;
the synthetic exact-image authentication rehearsal remains the evidence for
that workflow.

All three original containers resumed with unchanged images, configuration,
mounts and policies. Public health returned 200, both medication APIs returned
401 anonymously, and HTTPS validated. The disposable container and runner
exited; protected snapshot and restore files remain on the host. Sanitized local
evidence is in ignored `tmpdata/v2-preflight/real-result.json`,
`real-final-audit.json`, `image-archive-verification.json` and
`public-probes-after-pause.json`.

This closes the real snapshot/restore rehearsal gate. It is a same-host rollback
backup, not off-host disaster recovery. Production writes have resumed, so take
a new stopped snapshot immediately before an approved deployment. Publication,
deployment, provider UAT and post-deployment checks remain separate gates.

## rc.2 deployment recovery point

The authorized integration/settings rollout completed on 2026-10-24
(2026-10-25 01:46 UTC). Production ran **2.0.0-rc.2**, source
`5faff897901facff2f6fcb6fa3cfc6eb4a787b6b`, at the final read-back. Its
Linux/amd64 image configuration is
`sha256:1e742651b9ee57660f54abb5faabc375a44a3d55efd2c77b8f3d7960476e19a6`.
This is a local image promotion, not a registry publication.

The fresh stopped snapshot and private effective configuration are retained at
`/mnt/user/backups/healthtrack/deploy-integrations-rc2-20261025T014229Z`.
The compatible rollback binary is **rc.1**, source
`ef5745ab9c65e561e00c4334eb92a1958208ec70`, configuration
`sha256:7a8baf875797fafe9b427a1c100c57653d868dc1296db38d9b716fe80dedbc2b`.
Its verified archive is retained privately in that backup's `configuration`
directory. Configuration parents are 0700 and sensitive files are 0600.
Do not copy them into source control or publish diagnostic environment dumps.

The exact rc.1 binary successfully booted a separate restored copy offline,
and the candidate passed the same preservation checks before public access
resumed. All 46 tables, 474 columns, the unchanged 13-migration ledger, keys,
originals and encrypted-value usability passed. See
[deployment evidence](V2.md#integrations-release-on-unraid-2026-10-24) for
checks and qualifications.

This snapshot predates subsequent production writes. A later rollback requires
a fresh writer pause and preservation of the current full volume; use the
recorded rc.1 image with a verified copy of its matching snapshot and original
configuration. Do not overwrite newer records or start v0.8.1 against v2 data.
No automatic snapshot rollback is performed after public writes reopen.
The retained backup supports same-host rollback; off-host recovery and actual
provider reconnection remain separate checks.

### Oura corrective deployment recovery point

The 2026-10-24 corrective deployment (2026-10-25 04:33 UTC) retained version
2.0.0-rc.2 and promoted revision `abd78eaa5ecef462ecb02e9c5fa3f9d8592f1084`,
image configuration
`sha256:452d5e9a00f0eb9085650256898aa0f7e4a9c6a6d4d2037ed525f576c4161aa8`.
It adds no migration. The fresh recovery bundle is
`/mnt/user/backups/healthtrack/oura-permission-fix-20261025T042957Z`.
Its matching old binary is the earlier rc.2 revision `5faff89`, image
`sha256:1e742651b9ee57660f54abb5faabc375a44a3d55efd2c77b8f3d7960476e19a6`;
the old image archive and original effective configuration are retained privately
in that bundle. This pair passed the isolated restore and full preservation
checks described in [V2.md](V2.md#oura-permission-correction-2026-10-24).

The snapshot predates the conditional correction of the falsely expired Oura
status. Reverting to that binary also reintroduces its scope-error bug. Preserve
newer writes before any separately authorized rollback and account for that
operational state; do not silently discard data or automatically restore an old
snapshot after public writes resume. This remains same-host recovery evidence.
