import { type NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getUser } from '@/lib/auth/session';
import { getCapabilities } from '@/lib/capabilities';
import { encrypt } from '@/lib/crypto/encrypt';
import { safeError } from '@/lib/safe-log';
import { syncOuraData } from '@/lib/oura/sync';
import { OuraClient } from '@/lib/oura/client';
import { upsertConnectedSource } from '@/lib/repos/connected-sources';
import { getProfile, upsertProfile } from '@/lib/repos/profiles';

const STATE_COOKIE = 'oura_oauth_state';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const errorParam = request.nextUrl.searchParams.get('error');

  // Clear the state cookie regardless of outcome so it can't be replayed.
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  if (expectedState) {
    cookieStore.delete(STATE_COOKIE);
  }

  // Navigation route: unconfigured Oura redirects with a readable reason
  // instead of the 501 JSON the fetch-based Oura routes return.
  if (!getCapabilities().oura) {
    redirect('/settings?oura=error&reason=config_error');
  }

  if (errorParam) {
    redirect(`/settings?oura=error&reason=${encodeURIComponent(errorParam)}`);
  }

  if (!code) {
    redirect('/settings?oura=error&reason=missing_code');
  }

  // CSRF check: state must match the value we set when starting the flow.
  // Use a constant-time compare to avoid timing attacks.
  if (!state || !expectedState || !timingSafeEqualStr(state, expectedState)) {
    redirect('/settings?oura=error&reason=invalid_state');
  }

  // Authenticate the current user
  const user = await getUser();
  if (!user) {
    redirect('/login?redirect=/settings');
  }

  // Exchange authorization code for tokens
  // Derive redirect_uri from the incoming request so it always matches the
  // origin the user's browser used during the authorization step.
  const origin = request.nextUrl.origin;
  const tokenUrl = 'https://api.ouraring.com/oauth/token';
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.OURA_CLIENT_ID!,
    client_secret: process.env.OURA_CLIENT_SECRET!,
    redirect_uri: `${origin}/api/oura/callback`,
  });

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    safeError(`Oura token exchange failed: ${tokenRes.status}`);
    redirect('/settings?oura=error&reason=token_exchange_failed');
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  // Encrypt tokens before storage
  const accessTokenEncrypted = encrypt(tokenData.access_token);
  const refreshTokenEncrypted = encrypt(tokenData.refresh_token);
  const tokenExpiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000,
  ).toISOString();

  // Upsert connected source (owner-only repo; resets status + last_sync_at)
  try {
    await upsertConnectedSource(user.id, 'oura', {
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
    });
  } catch (err) {
    safeError('Failed to save Oura tokens', err);
    redirect('/settings?oura=error&reason=save_failed');
  }

  // Auto-fill missing profile fields from Oura personal info
  try {
    const ouraClient = new OuraClient(tokenData.access_token);
    const personalInfo = await ouraClient.getPersonalInfo();

    // Fetch current profile to check which fields are empty (legacy parity:
    // only an existing profile row is updated, never created here)
    const profile = await getProfile(user.id, user.id);

    if (profile) {
      const updates: Record<string, unknown> = {};

      // Convert Oura age to approximate date_of_birth (Jan 1 of birth year)
      if (!profile.dateOfBirth && personalInfo.age > 0) {
        const birthYear = new Date().getFullYear() - personalInfo.age;
        updates.dateOfBirth = `${birthYear}-01-01`;
      }

      // Convert kg to lbs (1 kg = 2.20462 lbs)
      if (!profile.weightLbs && personalInfo.weight > 0) {
        updates.weightLbs = Math.round(personalInfo.weight * 2.20462);
      }

      // Convert cm to inches (1 cm = 0.393701 in)
      if (!profile.heightInches && personalInfo.height > 0) {
        updates.heightInches = Math.round(personalInfo.height * 0.393701);
      }

      if (Object.keys(updates).length > 0) {
        await upsertProfile(user.id, user.id, updates);
      }
    }
  } catch (err) {
    // Non-blocking — profile auto-fill failure shouldn't prevent connection
    safeError('Oura profile auto-fill failed', err);
  }

  // Run backfill sync before redirecting so the dashboard has data when the
  // user lands back on /settings.
  try {
    await syncOuraData(user.id, tokenData.access_token, true);
  } catch (err) {
    safeError('Oura backfill sync failed', err);
    // Connection succeeded even if backfill fails — user can "Sync Now" later
  }

  redirect('/settings?oura=connected');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
