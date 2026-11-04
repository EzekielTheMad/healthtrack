import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listMedications } from '@/lib/repos/medications';
import { clinicalProjectionCoverage, listClinicalFacts } from '@/lib/fidelity/clinical';
import { clampLimit } from '@/lib/api/v1-fitness';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const ctx = await validateApiKey(authHeader);
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, 'read:medications')) return forbidden('read:medications');

  const includeInactive = request.nextUrl.searchParams.get('include_inactive') === 'true';

  try {
    if (request.nextUrl.searchParams.get('format') === 'typed') {
      const scope = { ownerId: ctx.userId, dependentId: null };
      const limit = clampLimit(request.nextUrl.searchParams.get('limit'), 200, 1000);
      const records = (
        await Promise.all([
          listClinicalFacts(ctx.userId, scope, { kind: 'medication', limit }),
          listClinicalFacts(ctx.userId, scope, { kind: 'medication_event', limit }),
        ])
      )
        .flat()
        .slice(0, limit);
      return Response.json(
        {
          format: 'typed',
          records,
          coverage: {
            limit,
            warning:
              'Includes dated medication history and explicitly reported events. Missing events do not imply missed doses; legacy receipt and status certainty remain unknown.',
          },
        },
        { headers: corsHeaders }
      );
    }
    // PAT scope: the key owner's own data, dependent_id NULL, name asc —
    // parity with the legacy PostgREST implementation.
    const rows = await listMedications(
      ctx.userId,
      { ownerId: ctx.userId, dependentId: null },
      { active: includeInactive ? undefined : true, orderBy: 'name' }
    );

    // Response shape byte-identical to the legacy PostgREST select: same fields,
    // same key order.
    return Response.json(
      rows.map((m) => ({
        id: m.id,
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        category: m.category,
        start_date: m.startDate,
        end_date: m.endDate,
        active: m.active,
        rxcui: m.rxcui,
      })),
      {
        headers: {
          ...corsHeaders,
          'Access-Control-Expose-Headers': 'X-HealthTrack-Clinical-Coverage, Link',
          'X-HealthTrack-Clinical-Coverage': JSON.stringify(
            await clinicalProjectionCoverage(
              ctx.userId,
              { ownerId: ctx.userId, dependentId: null },
              'medication'
            )
          ),
          Link: '</api/v1/medications?format=typed>; rel="alternate"',
        },
      }
    );
  } catch (error) {
    console.error('[v1] request failed:', error instanceof Error ? error.message : error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}
