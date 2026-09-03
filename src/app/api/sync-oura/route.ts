import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { getCapabilities, OURA_NOT_CONFIGURED } from '@/lib/capabilities';
import { syncOuraData } from '@/lib/oura/sync';
import { getConnectedSource } from '@/lib/repos/connected-sources';
import { getOuraAccessToken } from '@/lib/oura/tokens';

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
  try { accessToken = await getOuraAccessToken(user.id); }
  catch (error) { return apiError(401, 'token_refresh_failed', error instanceof Error ? error.message : 'Unable to obtain Oura token'); }
  const summary = await syncOuraData(user.id, accessToken);

  return NextResponse.json(summary);
}
