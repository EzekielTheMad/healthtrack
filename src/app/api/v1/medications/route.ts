import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listMedications } from '@/lib/repos/medications';

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
    // PAT scope: the key owner's own data, dependent_id NULL, name asc —
    // parity with the legacy PostgREST implementation.
    const rows = await listMedications(
      ctx.userId,
      { ownerId: ctx.userId, dependentId: null },
      { active: includeInactive ? undefined : true, orderBy: 'name' },
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
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
