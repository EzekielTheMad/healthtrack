// @vitest-environment node
import { describe, it, expect } from 'vitest';
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
