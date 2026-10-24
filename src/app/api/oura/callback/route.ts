import { type NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getUser } from '@/lib/auth/session';
import { getCapabilities } from '@/lib/capabilities';
import { encrypt } from '@/lib/crypto/encrypt';
import { safeError } from '@/lib/safe-log';
import { syncOuraData } from '@/lib/oura/sync';
import { OuraClient } from '@/lib/oura/client';
import { getOuraRedirectUri } from '@/lib/oura/oauth-origin';
import { upsertConnectedSource } from '@/lib/repos/connected-sources';
import { getProfile, upsertProfile } from '@/lib/repos/profiles';

const STATE_COOKIE = 'oura_oauth_state';
const SETTINGS_URL = '/settings?tab=integrations';
const settingsError = (reason: string) => `${SETTINGS_URL}&oura=error&reason=${reason}#oura`;

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const errorParam = request.nextUrl.searchParams.get('error');

  // Clear the state cookie regardless of outcome so it can't be replayed.
  const cookieStore = await cookies();
  const storedState = cookieStore.get(STATE_COOKIE)?.value;
  const issuedState = parseIssuedState(storedState);
  if (storedState !== undefined) {
    // Cookie deletion must match the path used by /start. Deleting by name
    // alone expires a different cookie at Path=/.
    cookieStore.set(STATE_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/oura',
      maxAge: 0,
    });
  }

  // Navigation route: unconfigured Oura redirects with a readable reason
  // instead of the 501 JSON the fetch-based Oura routes return.
  if (!getCapabilities().oura) {
    redirect(settingsError('config_error'));
  }

  if (errorParam) {
    redirect(settingsError(errorParam === 'access_denied' ? 'access_denied' : 'provider_error'));
  }

  if (!code) {
    redirect(settingsError('missing_code'));
  }

  // CSRF check: state must match the value we set when starting the flow.
  // Use a constant-time compare to avoid timing attacks.
  if (!state || !issuedState || !timingSafeEqualStr(state, issuedState.state)) {
    redirect(settingsError('invalid_state'));
  }

  // Authenticate the current user
  const user = await getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`${SETTINGS_URL}#oura`)}`);
  }
  if (user.id !== issuedState.userId) {
    redirect(settingsError('invalid_state'));
  }

  // Exchange authorization code for tokens
  // Use the configured public origin, never the reverse proxy's internal URL.
  // This must exactly match the URI sent during authorization.
  const tokenUrl = 'https://api.ouraring.com/oauth/token';
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.OURA_CLIENT_ID!,
    client_secret: process.env.OURA_CLIENT_SECRET!,
    redirect_uri: getOuraRedirectUri(),
  });

  let tokenRes: Response | undefined;
  let exchangeError: string | null = null;
  try {
    tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    exchangeError =
      error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'timeout'
        : 'network_error';
    safeError('Oura token exchange request failed');
  }
  if (exchangeError) redirect(settingsError(exchangeError));
  if (!tokenRes) redirect(settingsError('token_exchange_failed'));

  if (!tokenRes.ok) {
    safeError(`Oura token exchange failed: ${tokenRes.status}`);
    redirect(settingsError('token_exchange_failed'));
  }

  let tokenBody: unknown;
  try {
    tokenBody = await tokenRes.json();
  } catch (error) {
    exchangeError =
      error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'timeout'
        : error instanceof TypeError
          ? 'network_error'
          : 'invalid_response';
    safeError('Oura token exchange returned invalid JSON');
  }
  if (exchangeError) redirect(settingsError(exchangeError));
  const tokenData = tokenBody as
    | {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      }
    | null
    | undefined;
  const expiresAt =
    typeof tokenData?.expires_in === 'number' ? Date.now() + tokenData.expires_in * 1000 : NaN;
  if (
    !tokenData ||
    typeof tokenData.access_token !== 'string' ||
    !tokenData.access_token.trim() ||
    typeof tokenData.refresh_token !== 'string' ||
    !tokenData.refresh_token.trim() ||
    typeof tokenData.expires_in !== 'number' ||
    !Number.isFinite(tokenData.expires_in) ||
    tokenData.expires_in <= 0 ||
    !Number.isFinite(new Date(expiresAt).getTime())
  ) {
    redirect(settingsError('invalid_response'));
  }

  // Encrypt tokens before storage
  const accessTokenEncrypted = encrypt(tokenData.access_token);
  const refreshTokenEncrypted = encrypt(tokenData.refresh_token);
  const tokenExpiresAt = new Date(expiresAt).toISOString();

  // Upsert connected source (owner-only repo; resets status + last_sync_at)
  try {
    await upsertConnectedSource(user.id, 'oura', {
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
    });
  } catch (err) {
    safeError('Failed to save Oura tokens', err);
    redirect(settingsError('save_failed'));
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

      // Age does not establish an exact birth date. Leave unknown DOB for manual entry.

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
  let initialSync: 'success' | 'empty' | 'partial' | 'failed' = 'failed';
  try {
    const summary = await syncOuraData(user.id, tokenData.access_token, true);
    initialSync =
      summary.outcome === 'success'
        ? summary.synced === 0
          ? 'empty'
          : 'success'
        : summary.outcome === 'partial'
          ? 'partial'
          : 'failed';
  } catch (err) {
    safeError('Oura backfill sync failed', err);
    // Connection succeeded even if backfill fails — user can "Sync Now" later
  }

  redirect(`${SETTINGS_URL}&oura=connected&initial_sync=${initialSync}#oura`);
}

function parseIssuedState(value: string | undefined): { state: string; userId: string } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'state' in parsed &&
      typeof parsed.state === 'string' &&
      parsed.state &&
      'userId' in parsed &&
      typeof parsed.userId === 'string' &&
      parsed.userId
    ) {
      return { state: parsed.state, userId: parsed.userId };
    }
  } catch {
    // Legacy bare-state and malformed cookies require a fresh authorization.
  }
  return null;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
