import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listConditions } from '@/lib/repos/conditions';

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
  if (!hasScope(ctx, 'read:conditions')) return forbidden('read:conditions');

  try {
    // PAT scope: the key owner's own data, dependent_id NULL, ordered by
    // diagnosed_date desc — parity with the legacy PostgREST implementation.
    const rows = await listConditions(
      ctx.userId,
      { ownerId: ctx.userId, dependentId: null },
      { orderBy: 'diagnosed_date' },
    );

    // Response shape parity: same field list as the legacy PostgREST select.
    return Response.json(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        diagnosed_date: c.diagnosedDate,
        icd10_code: c.icd10Code,
        notes: c.notes,
      })),
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
