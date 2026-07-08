/**
 * POST /api/oura/disconnect — mark the Oura connection disconnected
 * (replaces the client's direct PostgREST status update; owner-only).
 * Tokens stay encrypted at rest until the user reconnects (legacy parity).
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { errorResponse } from '@/lib/api/respond';
import { getCapabilities, OURA_NOT_CONFIGURED } from '@/lib/capabilities';
import { setConnectedSourceStatus } from '@/lib/repos/connected-sources';

export async function POST() {
  try {
    const user = await requireUser();
    // Gated after auth so unauthenticated callers can't probe instance config.
    if (!getCapabilities().oura) {
      return apiError(501, OURA_NOT_CONFIGURED, OURA_NOT_CONFIGURED);
    }
    await setConnectedSourceStatus(user.id, 'oura', 'disconnected');
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
