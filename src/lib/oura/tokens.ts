import { decrypt } from '@/lib/crypto/decrypt';
import { encrypt } from '@/lib/crypto/encrypt';
import {
  getConnectedSource,
  setConnectedSourceStatus,
  updateConnectedSourceTokens,
} from '@/lib/repos/connected-sources';

const refreshLocks = new Map<string, Promise<string>>();

interface OuraRefreshResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

function errorDetail(data: OuraRefreshResponse, status: number): string {
  const code = typeof data.error === 'string' ? data.error : undefined;
  const description =
    typeof data.error_description === 'string' ? data.error_description : undefined;
  return [code, description].filter(Boolean).join(': ') || `HTTP ${status}`;
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
      throw new Error('Oura token expired and no refresh token is available');
    }
    const clientId = process.env.OURA_CLIENT_ID;
    const clientSecret = process.env.OURA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Oura OAuth client credentials are not configured');
    }
    const currentRefreshToken = decrypt(source.refreshTokenEncrypted);
    const response = await fetch('https://api.ouraring.com/oauth/token', {
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
      }
      throw new Error(`Failed to refresh Oura token: ${errorDetail(data, response.status)}`);
    }
    if (
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      typeof data.expires_in !== 'number' ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    ) {
      throw new Error('Oura token refresh returned an invalid response');
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
export async function getOuraAccessToken(userId: string): Promise<string> {
  const source = await getConnectedSource(userId, 'oura');
  if (!source || source.status !== 'active' || !source.accessTokenEncrypted) {
    throw new Error('Oura Ring is not connected');
  }
  const accessToken = decrypt(source.accessTokenEncrypted);
  const expiresAt = source.tokenExpiresAt ? Date.parse(source.tokenExpiresAt) : 0;
  if (!expiresAt || Date.now() < expiresAt - 60_000) return accessToken;
  return refresh(userId, source);
}
