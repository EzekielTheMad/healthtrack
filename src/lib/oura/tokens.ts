import { decrypt } from '@/lib/crypto/decrypt';
import { encrypt } from '@/lib/crypto/encrypt';
import {
  getConnectedSource,
  setConnectedSourceStatus,
  updateConnectedSourceTokens,
} from '@/lib/repos/connected-sources';
import { fetchOura, responseError, OuraApiError } from './errors';

const refreshLocks = new Map<string, Promise<string>>();

interface OuraRefreshResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

async function refresh(
  userId: string,
  source: NonNullable<Awaited<ReturnType<typeof getConnectedSource>>>
): Promise<string> {
  const existing = refreshLocks.get(userId);
  if (existing) return existing;

  const work = (async () => {
    if (!source.refreshTokenEncrypted) {
      await setConnectedSourceStatus(userId, 'oura', 'expired');
      throw new OuraApiError(401, 'auth_required');
    }
    const clientId = process.env.OURA_CLIENT_ID;
    const clientSecret = process.env.OURA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new OuraApiError(0, 'not_configured');
    }
    const currentRefreshToken = decrypt(source.refreshTokenEncrypted);
    const response = await fetchOura('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentRefreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    const data = (await response.json().catch(() => ({}))) as OuraRefreshResponse;
    if (!response.ok) {
      // invalid_grant means the refresh token is revoked, expired, or already
      // consumed. Network/server/configuration failures are recoverable and
      // must leave the connection active for the next scheduler attempt.
      if (data.error === 'invalid_grant') {
        await setConnectedSourceStatus(userId, 'oura', 'expired');
        throw new OuraApiError(401, 'invalid_grant');
      }
      if (
        data.error === 'invalid_client' ||
        data.error === 'unauthorized_client' ||
        data.error === 'invalid_scope'
      ) {
        throw new OuraApiError(0, 'not_configured');
      }
      throw responseError(response);
    }
    if (
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      typeof data.expires_in !== 'number' ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    ) {
      throw new OuraApiError(0, 'invalid_response');
    }
    const rotatedRefreshToken =
      typeof data.refresh_token === 'string' && data.refresh_token
        ? data.refresh_token
        : currentRefreshToken;
    await updateConnectedSourceTokens(userId, source.id, {
      accessTokenEncrypted: encrypt(data.access_token),
      refreshTokenEncrypted: encrypt(rotatedRefreshToken),
      tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    });
    return data.access_token;
  })();

  refreshLocks.set(userId, work);
  try {
    return await work;
  } finally {
    if (refreshLocks.get(userId) === work) refreshLocks.delete(userId);
  }
}

/** Return a usable access token, refreshing it once under a per-user lock. */
export async function getOuraAccessToken(
  userId: string,
  forceRefresh = false,
  rejectedAccessToken?: string
): Promise<string> {
  const source = await getConnectedSource(userId, 'oura');
  if (!source || source.status !== 'active' || !source.accessTokenEncrypted) {
    throw new OuraApiError(401, 'auth_required');
  }
  const accessToken = decrypt(source.accessTokenEncrypted);
  const expiresAt = source.tokenExpiresAt ? Date.parse(source.tokenExpiresAt) : 0;
  // Another collection may already have rotated this token while a 401 was in flight.
  if (forceRefresh && rejectedAccessToken && accessToken !== rejectedAccessToken)
    return accessToken;
  if (!forceRefresh && (!expiresAt || Date.now() < expiresAt - 60_000)) return accessToken;
  return refresh(userId, source);
}
