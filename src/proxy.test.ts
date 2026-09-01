// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

const SESSION = 'better-auth.session_token=abc.def';

function redirectTarget(res: Response): string | null {
  const loc = res.headers.get('location');
  return loc ? new URL(loc).pathname : null;
}

describe('proxy auth gate', () => {
  it.each(['/', '/login', '/signup', '/privacy', '/terms', '/docs/api', '/shared/some-token'])(
    'allows anonymous access to public page %s',
    (path) => {
      const res = proxy(request(path));
      expect(res.headers.get('location')).toBeNull();
    },
  );

  it('never redirects API requests (routes self-authenticate)', () => {
    for (const path of ['/api/auth/sign-in/email', '/api/v1/medications', '/api/health-query']) {
      const res = proxy(request(path));
      expect(res.headers.get('location')).toBeNull();
    }
  });

  it.each(['/dashboard', '/medications', '/settings', '/labs/123'])(
    'redirects anonymous app page %s to /login',
    (path) => {
      const res = proxy(request(path));
      expect(redirectTarget(res)).toBe('/login');
    },
  );

  it('lets a session cookie through to app pages', () => {
    const res = proxy(request('/dashboard', SESSION));
    expect(res.headers.get('location')).toBeNull();
  });

  it('recognizes the __Secure- prefixed cookie (HTTPS deployments)', () => {
    const res = proxy(
      request('/dashboard', '__Secure-better-auth.session_token=abc.def'),
    );
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects signed-in users away from /login and /signup', () => {
    for (const path of ['/login', '/signup']) {
      const res = proxy(request(path, SESSION));
      expect(redirectTarget(res)).toBe('/dashboard');
    }
  });
});

/**
 * Ordering guard: the canonical-host redirect must win over the auth gate.
 * The gate redirects with nextUrl.clone(), which preserves the incoming host —
 * so if the gate ran first, a signed-out visitor on `www` would land on
 * www/login and restart the OAuth flow from the non-canonical origin, which is
 * exactly the cookie split that produced `?error=state_mismatch`.
 */
describe('proxy canonical-host ordering', () => {
  const APP_URL = 'https://example.com';
  const savedAppUrl = process.env.APP_URL;

  afterEach(() => {
    if (savedAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = savedAppUrl;
  });

  /** A request off the tunnel: internal URL, public host in the header. */
  function hosted(host: string, path: string, cookie?: string): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      headers: cookie ? { host, cookie } : { host },
    });
  }

  it('sends a non-canonical host to APP_URL instead of that host’s /login', () => {
    process.env.APP_URL = APP_URL;
    const res = proxy(hosted('www.example.com', '/dashboard'));

    expect(res.headers.get('location')).toBe(
      'https://example.com/dashboard',
    );
  });

  it('still gates the canonical host normally', () => {
    process.env.APP_URL = APP_URL;
    const res = proxy(hosted('example.com', '/dashboard'));

    expect(redirectTarget(res)).toBe('/login');
  });

  it('leaves API requests on a non-canonical host alone', () => {
    process.env.APP_URL = APP_URL;
    const res = proxy(hosted('www.example.com', '/api/v1/medications'));

    expect(res.headers.get('location')).toBeNull();
  });
});
