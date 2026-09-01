// @vitest-environment node
/**
 * Canonical-host redirect (src/lib/canonical-host.ts).
 *
 * Regression cover for the Google OAuth `state_mismatch` bug: the app was
 * reachable on both the apex and `www`, so the Better Auth state cookie was
 * written on whichever host the browser sat on while `redirect_uri` (built
 * from APP_URL) always pointed at the apex — the callback then arrived
 * without the cookie and Better Auth rejected the state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { canonicalHostRedirect } from './canonical-host';

const APP_URL = 'https://example.com';

let savedAppUrl: string | undefined;

beforeEach(() => {
  savedAppUrl = process.env.APP_URL;
  process.env.APP_URL = APP_URL;
});

afterEach(() => {
  if (savedAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = savedAppUrl;
});

/** A request as it arrives from the tunnel: url is internal, host is public. */
function request(host: string, path = '/login'): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { host } });
}

describe('canonicalHostRedirect', () => {
  it('redirects a non-canonical public host to APP_URL, keeping path and query', () => {
    const res = canonicalHostRedirect(
      request('www.example.com', '/login?invite=abc123'),
    );

    expect(res?.status).toBe(307);
    expect(res?.headers.get('location')).toBe(
      'https://example.com/login?invite=abc123',
    );
  });

  it('leaves the canonical host alone', () => {
    expect(canonicalHostRedirect(request('example.com'))).toBeNull();
  });

  it('prefers x-forwarded-host over the Host header', () => {
    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: {
        host: 'example.com',
        'x-forwarded-host': 'www.example.com',
      },
    });

    expect(canonicalHostRedirect(req)?.headers.get('location')).toBe(
      'https://example.com/dashboard',
    );
  });

  it.each([
    ['/api/v1/metrics'],
    ['/api/auth/callback/google'],
    ['/api'],
  ])('never redirects API path %s (clients keep their configured host)', (path) => {
    expect(canonicalHostRedirect(request('www.example.com', path))).toBeNull();
  });

  it.each([['localhost:3000'], ['healthtrack:3000'], ['192.168.1.50:3000']])(
    'leaves direct/LAN access on %s alone',
    (host) => {
      expect(canonicalHostRedirect(request(host))).toBeNull();
    },
  );

  it('does nothing when APP_URL is unset', () => {
    delete process.env.APP_URL;
    expect(canonicalHostRedirect(request('www.example.com'))).toBeNull();
  });

  it('does nothing when APP_URL is unparseable', () => {
    process.env.APP_URL = 'not a url';
    expect(canonicalHostRedirect(request('www.example.com'))).toBeNull();
  });
});
