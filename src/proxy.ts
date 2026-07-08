/**
 * Next.js 16 proxy (replaces the deprecated middleware.ts convention).
 *
 * Optimistic auth gate only: checks better-auth session-cookie PRESENCE via
 * getSessionCookie — no DB or auth API calls here (per Next proxy guidance).
 * Real session validation happens in route handlers / server components via
 * src/lib/auth/session.ts.
 *
 * Public surface:
 *   /            (marketing)
 *   /privacy, /terms
 *   /login, /signup
 *   /shared/*    (tokenized public health-share views)
 *   /api/*       (routes self-authenticate and return 401 JSON; this includes
 *                 the better-auth handler at /api/auth/*)
 * Everything else — the (app) group — requires a session cookie.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

const PUBLIC_EXACT = new Set(['/', '/privacy', '/terms', '/login', '/signup']);
const PUBLIC_PREFIXES = ['/shared/', '/api/'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) || pathname === prefix.slice(0, -1),
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(getSessionCookie(request));

  // Signed-in users don't need the auth pages
  if (hasSessionCookie && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  if (!hasSessionCookie && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public assets
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
