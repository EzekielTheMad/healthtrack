import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getUser } from '@/lib/auth/session';
import { getCapabilities } from '@/lib/capabilities';

const OURA_SCOPE = 'daily heartrate spo2 personal';
const STATE_COOKIE = 'oura_oauth_state';
const STATE_MAX_AGE = 600; // 10 minutes

export async function GET(request: NextRequest) {
  // This route is hit by a top-level navigation from the Connect button,
  // not via fetch — so on errors we redirect with a human-readable reason
  // rather than returning a JSON error the browser would render raw.
  const settingsUrl = new URL('/settings', request.nextUrl.origin);
  const loginUrl = new URL('/login', request.nextUrl.origin);

  const user = await getUser();

  if (!user) {
    loginUrl.searchParams.set('redirect', '/settings');
    return NextResponse.redirect(loginUrl);
  }

  // Navigation route: unconfigured Oura redirects with a readable reason
  // instead of the 501 JSON the fetch-based Oura routes return.
  if (!getCapabilities().oura) {
    settingsUrl.searchParams.set('oura', 'error');
    settingsUrl.searchParams.set('reason', 'config_error');
    return NextResponse.redirect(settingsUrl);
  }
  const clientId = process.env.OURA_CLIENT_ID!;

  const state = randomBytes(32).toString('hex');

  const authUrl = new URL('https://cloud.ouraring.com/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', `${request.nextUrl.origin}/api/oura/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', OURA_SCOPE);
  authUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/oura',
    maxAge: STATE_MAX_AGE,
  });
  return response;
}
