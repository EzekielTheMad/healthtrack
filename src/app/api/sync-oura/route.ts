import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { getCapabilities, OURA_NOT_CONFIGURED } from '@/lib/capabilities';
import { syncOuraData } from '@/lib/oura/sync';
import { getConnectedSource } from '@/lib/repos/connected-sources';

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

  if (source.nextRetryAt && Date.parse(source.nextRetryAt) > Date.now()) {
    return NextResponse.json(
      {
        message: 'Oura is rate limited. Wait until the retry time.',
        next_retry_at: source.nextRetryAt,
      },
      { status: 429 }
    );
  }
  const summary = await syncOuraData(user.id);

  return NextResponse.json(summary);
}
