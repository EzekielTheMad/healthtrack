import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { getCapabilities, OURA_NOT_CONFIGURED } from '@/lib/capabilities';
import { decrypt } from '@/lib/crypto/decrypt';
import { encrypt } from '@/lib/crypto/encrypt';
import { syncOuraData } from '@/lib/oura/sync';
import {
  getConnectedSource,
  setConnectedSourceStatus,
  updateConnectedSourceTokens,
} from '@/lib/repos/connected-sources';

export async function POST() {
  const user = await getUser();
  if (!user) {
    return apiError(401, 'unauthorized', 'Authentication required');
  }

  // Gated after auth so unauthenticated callers can't probe instance config.
  if (!getCapabilities().oura) {
    return apiError(501, OURA_NOT_CONFIGURED, OURA_NOT_CONFIGURED);
  }

  // Fetch connected source (owner-only repo)
  const source = await getConnectedSource(user.id, 'oura');

  if (!source || source.status !== 'active' || !source.accessTokenEncrypted) {
    return apiError(404, 'not_found', 'Oura Ring is not connected');
  }

  let accessToken: string;

  try {
    accessToken = decrypt(source.accessTokenEncrypted);
  } catch {
    return apiError(500, 'decrypt_error', 'Failed to decrypt access token');
  }

  // Check if token is expired and refresh if needed
  const expiresAt = source.tokenExpiresAt
    ? new Date(source.tokenExpiresAt).getTime()
    : 0;

  if (expiresAt > 0 && Date.now() >= expiresAt - 60_000) {
    // Token expired or about to expire — refresh it
    if (!source.refreshTokenEncrypted) {
      return apiError(
        401,
        'token_expired',
        'Oura token expired and no refresh token available. Please reconnect.',
      );
    }

    let refreshToken: string;
    try {
      refreshToken = decrypt(source.refreshTokenEncrypted);
    } catch {
      return apiError(500, 'decrypt_error', 'Failed to decrypt refresh token');
    }

    const refreshRes = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.OURA_CLIENT_ID!,
        client_secret: process.env.OURA_CLIENT_SECRET!,
      }).toString(),
    });

    if (!refreshRes.ok) {
      // Mark source as needing reconnection
      await setConnectedSourceStatus(user.id, 'oura', 'expired');

      return apiError(
        401,
        'refresh_failed',
        'Failed to refresh Oura token. Please reconnect your Oura Ring.',
      );
    }

    const tokenData = (await refreshRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    accessToken = tokenData.access_token;

    // Persist refreshed tokens
    await updateConnectedSourceTokens(user.id, source.id, {
      accessTokenEncrypted: encrypt(tokenData.access_token),
      refreshTokenEncrypted: encrypt(tokenData.refresh_token),
      tokenExpiresAt: new Date(
        Date.now() + tokenData.expires_in * 1000,
      ).toISOString(),
    });
  }

  // Run sync
  const summary = await syncOuraData(user.id, accessToken);

  return NextResponse.json(summary);
}
