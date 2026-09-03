/**
 * Canonical Oura callback URI.
 *
 * Reverse proxies often expose an internal request origin such as
 * http://0.0.0.0:3000 to Next.js. OAuth redirect URIs must instead use the
 * operator-configured public APP_URL, matching the provider allowlist and the
 * host that owns the OAuth state cookie.
 */
export function getOuraRedirectUri(): string {
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    throw new Error('APP_URL is required for Oura OAuth');
  }

  const url = new URL(appUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('APP_URL must use http or https');
  }

  return new URL('/api/oura/callback', `${url.origin}/`).toString();
}