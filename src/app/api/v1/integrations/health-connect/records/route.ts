/**
 * GET /api/v1/integrations/health-connect/records — bounded, filtered access
 * to the retained raw Health Connect records.
 *
 * Requires `read:health_connect` (or `read:all`). `write:health_connect` does
 * NOT satisfy it.
 *
 * These are DIAGNOSTIC / SOURCE records: exactly what the phone delivered,
 * deduplicated but not unit-normalized, not deconflicted against the direct
 * Oura/Renpho/myAir bridges, and not a product analytics surface. Clients
 * should read canonical domain endpoints instead wherever one exists:
 *   nutrition actuals            → /api/v1/nutrition/daily
 *   approved daily activity      → /api/v1/vitals (source health_connect_daily)
 *   completed programmed workouts→ /api/v1/workouts
 * This endpoint exists for the types that are deliberately raw-only, and for
 * debugging what a source actually sent.
 *
 * Bounds (no permissive defaults — a missing bound is a 400, never "all of
 * it"): integration_id or record_type is required, an explicit start_at/end_at
 * range is required, and pages are cursor-paginated with a conservative cap.
 *
 * Query: ?integration_id=&record_type=&source_package=&start_at=&end_at=
 *        &limit=&cursor=
 */
import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import {
  UnboundedQueryError,
  listRawRecordsPage,
  RAW_RECORDS_MAX_PAGE,
} from '@/lib/repos/health-connect';
import { safeError } from '@/lib/safe-log';

const SCOPE = 'read:health_connect';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, SCOPE)) return forbidden(SCOPE);

  const { searchParams } = request.nextUrl;
  const rawLimit = parseInt(searchParams.get('limit') ?? '', 10);

  try {
    const page = await listRawRecordsPage(ctx.userId, {
      integrationId: searchParams.get('integration_id') ?? undefined,
      recordType: searchParams.get('record_type') ?? undefined,
      sourcePackage: searchParams.get('source_package') ?? undefined,
      startAt: searchParams.get('start_at') ?? undefined,
      endAt: searchParams.get('end_at') ?? undefined,
      limit: Number.isNaN(rawLimit) ? undefined : rawLimit,
      cursor: searchParams.get('cursor') ?? undefined,
    });

    return Response.json(
      {
        records: page.records,
        next_cursor: page.next_cursor,
        max_page_size: RAW_RECORDS_MAX_PAGE,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof UnboundedQueryError) {
      return Response.json({ error: error.message }, { status: 400, headers: corsHeaders });
    }
    // Never reflect internal error details to API clients (respond.ts policy).
    safeError('v1 health-connect records GET error:', error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}
