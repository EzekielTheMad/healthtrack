# HealthTrack release and verification notes

This document owns HealthTrack-specific container and release knowledge. It is
not permission to publish an image, change package visibility, submit a CA
listing or deploy an instance. For Rook's generic engineering workflow, use the
[engineering SOP](obsidian://open?file=systems%2Fengineering-sops) (private
operator vault entry); reusable procedures live in Rook's linked skills, not
copies here. Other contributors follow the repository instructions and their
maintainer's authorization.

## Container implementation

- [Dockerfile](../Dockerfile) builds dependencies with Python/make/g++, then
  Next.js standalone output and an esbuild-bundled migration runner. The runtime
  stage adds `su-exec` and `wget`, not the native build toolchain.
- All persistent state is under `/data`: SQLite, uploads and generated keys.
  [The entrypoint](../docker/entrypoint.sh) starts as root, creates directories,
  recursively normalizes ownership to `PUID:PGID` (default `99:100`), then runs
  **both migrations and the server after dropping privileges**. Migrations are
  automatic at startup; users do not run a separate migration command.
- The recursive ownership repair is intentional: checking only `/data` misses
  root-owned child directories. Do not replace it with a top-level-only check.
- [Secret initialization](../src/lib/runtime/keys.ts) prefers explicit environment
  overrides, reuses existing key files, or generates keys with mode `0600`.
  See [configuration and backup](../README.md#configuration); losing keys can
  make encrypted credentials unusable.
- Docker's healthcheck calls unauthenticated
  [`/api/health`](../src/app/api/health/route.ts). That route executes `select 1`
  against SQLite and returns `503` on a caught database-check failure. Health
  alone does not prove registration policy, authorization or successful restore.

## Image release implementation

[release.yml](../.github/workflows/release.yml) runs on `v*` tag pushes. It builds
`linux/amd64` on `ubuntu-latest` and `linux/arm64` on `ubuntu-24.04-arm`, pushes
images by digest, then assembles the multi-architecture manifest with full semver,
major/minor and `latest` tags at `ghcr.io/ezekielthemad/healthtrack`.

Native builds deliberately avoid QEMU: the workflow records slow or hanging
emulated `node-gyp` builds. `latest` is mutable, not a rollback identity. Record
the source SHA, workflow result and manifest/platform digests for an authorized
release. If anonymous installation is intended, verify an unauthenticated pull;
a workflow push does not prove package visibility. Visibility changes and
release-tag pushes require separate publication authority.

## Release evidence requirements

These are retained project checks, **not a claim that the current release or a
running instance has passed them**. Use disposable instances and synthetic data;
do not test account creation or imports against production health records.

1. Keep the existing [CI](../.github/workflows/ci.yml) gates: lint, unit tests,
   production build and Docker smoke. Its smoke checks health, first-user
   bootstrap, second-user rejection, a medication round-trip and an authenticated
   AI-unconfigured `501`. Record actual results for the candidate, not just the
   workflow's presence.
2. Prove a stranger-install with an empty, isolated volume and an unused port:
   health, generated keys/ownership, first account as admin, a second signup
   without an invite returning `403`, valid invite use, expiry/replay rejection,
   and persistence across restart. Remove only the disposable test resources.
   Check email and configured social account-creation paths; a successful
   first-user bootstrap is not evidence that later signup is closed.
3. Verify the intended signup policy **after each authorized deployment or
   recreate**, including configuration restored from Unraid templates. Preserve
   operator values as described in [UNRAID.md](UNRAID.md#updates-and-applied-templates).
4. Verify security-sensitive behavior for the affected release: cross-user and
   dependent access, authentication brute-force limits and expensive-route limits;
   upload size caps, file-signature validation rather than trusting client MIME,
   and `nosniff` on served uploads; generic `500` responses without reflected
   internal exception details. Verify PAT hash-only storage, scopes, expiry and
   revocation, and encrypted OAuth token storage. These checks do not assert
   universal coverage across current routes.
5. Check application-supplied headers and production Secure session cookies
   behind the actual TLS-terminating proxy. [next.config.ts](../next.config.ts)
   defines CSP (including Next's inline-script/style allowances), DENY framing,
   `nosniff`, Referrer/Permissions policies and production HSTS **without**
   `includeSubDomains`/preload. [Auth configuration](../src/lib/auth/index.ts)
   forces Secure cookies in production. Inspect observed responses rather than
   inferring safety from a proxy configuration. Retain the qualifications in
   [SECURITY.md](../SECURITY.md), including unverified-email sharing and signed
   Health Connect ingestion.
6. Keep health/legal wording visible: signup consent, legal links in the app
   shell and disclaimers on AI surfaces, with shared wording. Terms must agree
   with the [MIT license](../LICENSE) and the free, self-hosted, as-is model;
   do not imply HIPAA compliance, medical advice or a paid liability cap.
   Review public screenshots using fictional data only. This is a content check,
   not a legal opinion or a mandate for a fixed number of review agents.
7. When landing-page discoverability matters, inspect server-rendered HTML and
   browser behavior: a client-rendered spinner is not proof of meaningful SSR.
   Verify social metadata uses the configured `APP_URL`, not localhost.
   For AI/import changes, check unconfigured feature hiding and authenticated
   `501` behavior, cache/refresh and repeat-query deduplication where applicable,
   and review-before-write with partial-extraction warnings. Do not infer that
   every AI endpoint implements caching from this requirement.
8. Before authorized promotion, preserve a consistent stopped-container backup
   of `/data` and the effective configuration, plus the prior immutable image
   identity. Test restore in isolation. Because startup applies migrations,
   reverting an image alone may be unsafe; use a compatible image/data pair or
   restore the pre-upgrade snapshot under operator authority. After promotion
   read back the running identity, health and affected security behavior. A
   backup's existence is not a successful restore drill.

## Historical lessons (July 2026; not current deployment state)

The original project playbook recorded signup configuration drift after recreating
from a running container's environment and Unraid template defaults. This is the
reason to compare against intended configuration and explicitly exclude unwanted
inherited environment values; it is not evidence of today's host configuration.

It also recorded a private-to-public mirror leaking a private handoff through a
changed-file-list sync. If such a mirror is separately authorized again, export
the complete approved tree with explicit private-path exclusions, inspect the
whole export for private identifiers, addresses, domains, tokens and notes, use
the approved GitHub noreply identity, and independently review the exact public
candidate before publication. This repository does not establish a current
mirror topology or grant synchronization/publication permission.
