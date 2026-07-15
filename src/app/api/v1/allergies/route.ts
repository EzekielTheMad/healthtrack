import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listAllergies } from '@/lib/repos/allergies';

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
  if (!hasScope(ctx, 'read:allergies')) return forbidden('read:allergies');

  try {
    // PAT scope: the key owner's own data, dependent_id NULL, name asc —
    // parity with the legacy PostgREST implementation.
    const rows = await listAllergies(
      ctx.userId,
      { ownerId: ctx.userId, dependentId: null },
      { orderBy: 'name' },
    );

    // Response shape parity: same field list as the legacy PostgREST select.
    return Response.json(
      rows.map((a) => ({
        id: a.id,
        name: a.name,
        severity: a.severity,
        reaction: a.reaction,
        diagnosed_date: a.diagnosedDate,
        rxcui: a.rxcui,
      })),
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error('[v1] request failed:', error instanceof Error ? error.message : error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}
