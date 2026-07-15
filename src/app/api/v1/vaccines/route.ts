import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listVaccines } from '@/lib/repos/vaccines';

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
  if (!hasScope(ctx, 'read:vaccines')) return forbidden('read:vaccines');

  try {
    // PAT scope: the key owner's own data, dependent_id NULL, vaccine_date
    // desc — parity with the legacy PostgREST implementation.
    const rows = await listVaccines(ctx.userId, {
      ownerId: ctx.userId,
      dependentId: null,
    });

    // Response shape parity: same field list as the legacy PostgREST select.
    return Response.json(
      rows.map((v) => ({
        id: v.id,
        name: v.name,
        cvx_code: v.cvxCode,
        vaccine_date: v.vaccineDate,
        dose_number: v.doseNumber,
        series_doses: v.seriesDoses,
        manufacturer: v.manufacturer,
        next_dose_date: v.nextDoseDate,
      })),
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error('[v1] request failed:', error instanceof Error ? error.message : error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}
