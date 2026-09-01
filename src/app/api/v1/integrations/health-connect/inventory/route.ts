/**
 * GET /api/v1/integrations/health-connect/inventory — what HealthTrack
 * retained from Health Connect, by record type and exact source package.
 *
 * Requires `read:health_connect` (or `read:all`). `write:health_connect` does
 * NOT satisfy it: the token pasted into a phone delivers records, it does not
 * get to read the retained history back out.
 *
 * This is the source-coverage and ingestion-diagnostics surface. Product
 * analytics should prefer the canonical domain endpoints —
 * /api/v1/nutrition/daily for actual intake, /api/v1/vitals for approved daily
 * metrics — because those are deduplicated, unit-normalized and stable.
 *
 * Query: ?integration_id=&record_type=&source_package= (all exact matches).
 */
import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { getApiInventory } from '@/lib/repos/health-connect';
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

  try {
    const entries = await getApiInventory(ctx.userId, {
      integrationId: searchParams.get('integration_id') ?? undefined,
      recordType: searchParams.get('record_type') ?? undefined,
      sourcePackage: searchParams.get('source_package') ?? undefined,
    });

    return Response.json(
      entries.map((e) => ({
        integration_id: e.integrationId,
        integration_status: e.integrationStatus,
        record_type: e.recordType,
        source_package: e.sourcePackage,
        identity_kind: e.identityKind,
        record_count: e.count,
        earliest_record_at: e.oldest,
        latest_record_at: e.newest,
        fields_observed: e.populatedFields,
        canonical_policy: e.canonicalPolicy,
        canonical_policy_reason: e.canonicalPolicyReason,
        last_received_at: e.lastReceivedAt,
        last_normalized_at: e.lastNormalizedAt,
        last_seen_at: e.lastSeenAt,
      })),
      { headers: corsHeaders },
    );
  } catch (error) {
    // Never reflect internal error details to API clients (respond.ts policy).
    safeError('v1 health-connect inventory GET error:', error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}
