/**
 * Canonical-host redirect.
 *
 * Cookies are host-scoped. When a reverse proxy/tunnel answers on more than
 * one public hostname (the classic apex + `www` pair), a browser sitting on
 * the non-canonical host gets its auth cookies written there, while anything
 * derived from APP_URL — most importantly the Google OAuth `redirect_uri` —
 * points at the canonical host. The provider then returns the browser to a
 * host that never received the cookie:
 *
 *   1. GET https://www.example.com/login          → state cookie set on `www`
 *   2. redirect_uri = https://example.com/...     → built from APP_URL (apex)
 *   3. Google redirects to the apex               → no `www` cookie is sent
 *   4. Better Auth: "State not persisted correctly"
 *      → /api/auth/error?error=state_mismatch → /?error=state_mismatch
 *
 * The same split silently halves sessions (sign in on `www`, look signed out
 * on the apex). Anchoring every browser navigation to APP_URL's host fixes
 * both, and is the one place that can do it before the sign-in POST fires.
 *
 * Deliberately narrow:
 *  - `/api/*` is never redirected, so API keys, the Health Connect webhook,
 *    and the companion app keep working against whatever hostname the
 *    operator configured. (Checked here rather than left to the proxy
 *    matcher, so this stays correct under any matcher it is mounted with.)
 *  - Local/direct access (localhost, bare hostnames, raw IPs) is left alone,
 *    so reaching the container on the LAN still works when APP_URL is public.
 *  - 307, not 308: APP_URL is operator-configurable and a permanent redirect
 *    would stick in browser caches long after they changed it.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** APP_URL's origin + host, or null when unset/unparseable (→ no redirect). */
function canonical(): { origin: string; host: string } | null {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return null;
  try {
    const url = new URL(appUrl);
    return { origin: url.origin, host: url.host };
  } catch {
    return null;
  }
}

/**
 * Hosts we never redirect away from: loopback, bare hostnames (`healthtrack:3000`),
 * and IP literals. These are direct/LAN access paths, not the public origin
 * the cookie split happens on.
 */
function isLocalHost(host: string): boolean {
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (!hostname.includes('.')) return true; // bare container/LAN name
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true; // IPv4 literal
  if (hostname.startsWith('[')) return true; // IPv6 literal
  return false;
}

/**
 * A 307 to the same path on APP_URL's origin, or null when the request is
 * already canonical (or must not be touched) and should carry on.
 */
export function canonicalHostRedirect(request: NextRequest): NextResponse | null {
  const target = canonical();
  if (!target) return null;

  const { pathname, search } = request.nextUrl;
  if (pathname === '/api' || pathname.startsWith('/api/')) return null;

  // The host the browser actually used: the tunnel/proxy forwards it as
  // x-forwarded-host, otherwise it is the Host header.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host || host === target.host || isLocalHost(host)) return null;

  return NextResponse.redirect(new URL(`${pathname}${search}`, target.origin), 307);
}
