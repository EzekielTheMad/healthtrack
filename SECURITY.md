# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via **GitHub Security Advisories**: go to the repository's *Security* tab → *Report a vulnerability*. Do not open a public issue for security problems.

You should get an initial response within a week. Please include reproduction steps and the affected version/commit.

## Scope & context

HealthTrack stores **sensitive personal health data**. Take reports of authentication, authorization (cross-user data access), file-upload and injection issues especially seriously — and as an operator:

- Keep your instance behind HTTPS (reverse proxy) if it is reachable from the internet.
- Set `SIGNUPS_ENABLED=false` after creating your accounts.
- Back up `/data` — it contains the database, uploads and your auto-generated secrets.

## Multi-user trust model

HealthTrack does **not** verify email addresses (there is no built-in mail
delivery). Share and delegate invitations are matched by the email address a
signed-in account registered with. On an instance with **open signups**,
anyone who can register the invited address can see and accept that
invitation. Therefore:

- **Set `SIGNUPS_ENABLED=false` before sending share/delegate invitations**,
  or only run open signups on a network limited to people you trust.
- Invitations grant nothing until accepted, and accepted links are never
  re-pointed if an email address is later re-registered by someone else.
- A share **link token** (the `/shared/…` URL) serves a slightly broader
  section set than the same share viewed from a signed-in account (legacy
  parity: providers, appointments and notes are included in the token view).
  Treat share links like passwords.

## Telemetry

HealthTrack sends **no telemetry**. The only outbound connections are the optional integrations you configure yourself (Anthropic API, Google OAuth, Oura API).
