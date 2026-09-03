import { decrypt } from '@/lib/crypto/decrypt';
import { encrypt } from '@/lib/crypto/encrypt';
import { getConnectedSource, setConnectedSourceStatus, updateConnectedSourceTokens } from '@/lib/repos/connected-sources';

const refreshLocks = new Map<string, Promise<string>>();

async function refresh(userId: string, source: NonNullable<Awaited<ReturnType<typeof getConnectedSource>>>): Promise<string> {
  const existing = refreshLocks.get(userId);
  if (existing) return existing;
  const work = (async () => {
    if (!source.refreshTokenEncrypted) throw new Error('Oura token expired and no refresh token available');
    const response = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decrypt(source.refreshTokenEncrypted), client_id: process.env.OURA_CLIENT_ID ?? '', client_secret: process.env.OURA_CLIENT_SECRET ?? '' }).toString(),
    });
    if (!response.ok) { await setConnectedSourceStatus(userId, 'oura', 'expired'); throw new Error('Failed to refresh Oura token'); }
    const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
    await updateConnectedSourceTokens(userId, source.id, {
      accessTokenEncrypted: encrypt(data.access_token),
      refreshTokenEncrypted: encrypt(data.refresh_token ?? decrypt(source.refreshTokenEncrypted)),
      tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    });
    return data.access_token;
  })();
  refreshLocks.set(userId, work);
  try { return await work; } finally { refreshLocks.delete(userId); }
}

/** Return a usable access token, refreshing the user's stored OAuth token once under a per-user lock. */
export async function getOuraAccessToken(userId: string): Promise<string> {
  const source = await getConnectedSource(userId, 'oura');
  if (!source || source.status !== 'active' || !source.accessTokenEncrypted) throw new Error('Oura Ring is not connected');
  const accessToken = decrypt(source.accessTokenEncrypted);
  const expiresAt = source.tokenExpiresAt ? Date.parse(source.tokenExpiresAt) : 0;
  if (!expiresAt || Date.now() < expiresAt - 60_000) return accessToken;
  return refresh(userId, source);
}
