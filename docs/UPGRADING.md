# Upgrade and rollback preflight

An upgrade applies migrations automatically at container startup. Keep the old
image **and its pre-upgrade data** together. Starting an old image against an
already migrated database is not the rollback procedure.

This checklist does not authorize publication, an outage, or a deployment.
Use [RELEASE.md](RELEASE.md) for release gates and [UNRAID.md](UNRAID.md) for
applied-template handling. Store instance-specific evidence outside Git.

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
