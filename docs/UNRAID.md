# Installing HealthTrack on Unraid

HealthTrack runs as a single Docker container. All state (SQLite database,
uploaded PDFs, auto-generated secrets) lives in one volume — back up
`/mnt/user/appdata/healthtrack` and you have backed up everything.

## Option 1 — Community Applications (once listed)

1. Open the **Apps** tab in the Unraid web UI.
2. Search for **HealthTrack** and click **Install**.
3. Set **APP_URL** to the address you will browse to, e.g.
   `http://192.168.1.50:3000` (or your reverse-proxy HTTPS URL).
4. Apply. Open the WebUI and register — the **first account becomes the
   instance admin**. After that, registration is invite-only by default — add
   family via single-use links from **Settings → Invites** (or set
   `SIGNUPS_ENABLED=true` to open registration to anyone).

## Option 2 — Manual template URL (before/without CA listing)

1. Go to the **Docker** tab and scroll to **Template Repositories**.
2. Add the repository URL and click **Save**:

   ```
   https://github.com/EzekielTheMad/healthtrack
   ```

3. Click **Add Container** and pick **healthtrack** from the *Select a
   template* dropdown (under *User templates*).
4. Fill in **APP_URL** as above and apply.

Alternatively, download the raw template and drop it into
`/boot/config/plugins/dockerMan/templates-user/` on your flash drive:

```
https://raw.githubusercontent.com/EzekielTheMad/healthtrack/main/unraid/healthtrack.xml
```

## Option 3 — docker compose / docker run

```bash
docker run -d \
  --name healthtrack \
  -p 3000:3000 \
  -v /mnt/user/appdata/healthtrack:/data \
  -e APP_URL=http://YOUR_SERVER_IP:3000 \
  -e PUID=99 -e PGID=100 \
  ghcr.io/ezekielthemad/healthtrack:latest
```

Or use the [`docker-compose.yml`](../docker-compose.yml) in the repository
root, which documents every optional environment variable.

> **Port conflict?** The template maps host port **3000** by default. If another
> container already uses it (Mealie, Grafana and many others default to 3000),
> change the **host** side of the port mapping to a free port and set `APP_URL`
> to match — e.g. host port `3005` with `APP_URL=http://YOUR_SERVER_IP:3005`.
> The container always listens on 3000 internally.

## Optional integrations

Each feature activates only when its variables are set; the UI hides it
otherwise.

| Feature | Variables | Notes |
|---|---|---|
| AI summaries, queries, PDF parsing | `ANTHROPIC_API_KEY` | Anthropic API key |
| Sign in with Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **Needs a public HTTPS URL** — see below |
| Oura Ring sync | `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET` | Redirect URI in the **Oura developer portal** |

`AUTH_SECRET` and `ENCRYPTION_KEY` are auto-generated into `/data/keys` on
first boot; only set them if you want to manage secrets yourself.

### Google sign-in needs HTTPS on a real hostname

Email/password login works on a plain LAN IP, but **Google OAuth does not**.
Google rejects `http://` and raw IP-address redirect URIs (only
`http://localhost` is exempt), so `http://192.168.x.x:3000` fails with
`redirect_uri_mismatch`. To use Google sign-in, serve HealthTrack over HTTPS on
a real hostname — a reverse proxy (Nginx Proxy Manager, Swag) or a Cloudflare
Tunnel — set `APP_URL` to that `https://…` address, and add this Authorized
redirect URI in the **Google Cloud Console** OAuth client:

```
APP_URL/api/auth/callback/google
```

### Google vs Oura — different consoles

Google and Oura are separate providers. The Google redirect URI goes in the
**Google Cloud Console**; the Oura redirect URI goes in the **Oura developer
portal**. Putting one in the other's console does nothing. Oura's redirect URI
(a LAN IP is acceptable here) is:

```
APP_URL/api/oura/callback
```

Whatever `APP_URL` you choose, it must exactly match the address you browse to
(scheme, host and port). Restart the container after changing it.

## Submitting the template to Community Applications (repo owner)

CA listing is a one-time action by the repository owner, via the submission
portal at <https://ca.unraid.net/submit>. This repository already satisfies the
prerequisites:

- **Public, active repo** ✅
- **OSI-approved `LICENSE` at root** ✅ (MIT)
- **`ca_profile.xml` at root** with a non-empty `<Profile>` ✅
- **Valid Docker template XML** ✅ (`unraid/healthtrack.xml`, `<TemplateURL>` self-referencing)

Steps:

1. Read the submission help at <https://ca.unraid.net/submit/help>.
2. Open <https://ca.unraid.net/submit/new>, point it at this repository, and run
   **Validate** and **Scan**. Fix anything the scanner flags (it parses the
   Docker entries, checks author/support metadata, checks for duplicate CA
   listings, and generates a listing preview).
3. (Recommended) Create a dedicated Unraid support thread and update
   `<Forum>` in `ca_profile.xml` to point at it, so users have a stable place
   to ask questions.
4. Submit. Once accepted into the CA feed, the app appears in the **Apps** tab;
   subsequent template updates are picked up automatically from the repository.

> Maintainer responsibility: CA expects published apps to be kept compatible
> with new Unraid releases and support requests answered in the forum thread.
