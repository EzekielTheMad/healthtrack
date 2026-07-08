/**
 * GET /api/oura/status — connection state for the settings card (replaces the
 * client's direct PostgREST `connected_sources` read; owner-only).
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { errorResponse } from '@/lib/api/respond';
import { getCapabilities, OURA_NOT_CONFIGURED } from '@/lib/capabilities';
import { getConnectedSource } from '@/lib/repos/connected-sources';

export async function GET() {
  try {
    const user = await requireUser();
    // Gated after auth so unauthenticated callers can't probe instance config.
    if (!getCapabilities().oura) {
      return apiError(501, OURA_NOT_CONFIGURED, OURA_NOT_CONFIGURED);
    }
    const source = await getConnectedSource(user.id, 'oura');
    return NextResponse.json({
      status: source?.status ?? null,
      last_sync_at: source?.lastSyncAt ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
