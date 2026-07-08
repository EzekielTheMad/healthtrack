# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via **GitHub Security Advisories**: go to the repository's *Security* tab → *Report a vulnerability*. Do not open a public issue for security problems.

You should get an initial response within a week. Please include reproduction steps and the affected version/commit.

## Scope & context

HealthTrack stores **sensitive personal health data**. Take reports of authentication, authorization (cross-user data access), file-upload and injection issues especially seriously — and as an operator:

- Keep your instance behind HTTPS (reverse proxy) if it is reachable from the internet.
- Set `SIGNUPS_ENABLED=false` after creating your accounts.
- Back up `/data` — it contains the database, uploads and your auto-generated secrets.

## Telemetry

HealthTrack sends **no telemetry**. The only outbound connections are the optional integrations you configure yourself (Anthropic API, Google OAuth, Oura API).
