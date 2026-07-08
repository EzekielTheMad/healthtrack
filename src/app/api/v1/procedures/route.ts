import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listProcedures } from '@/lib/repos/procedures';

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
  if (!hasScope(ctx, 'read:procedures')) return forbidden('read:procedures');

  try {
    // PAT scope: the key owner's own data, dependent_id NULL, procedure_date
    // desc — parity with the legacy PostgREST implementation.
    const rows = await listProcedures(ctx.userId, {
      ownerId: ctx.userId,
      dependentId: null,
    });

    // Response shape parity: same field list as the legacy PostgREST select.
    return Response.json(
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        cpt_code: p.cptCode,
        procedure_date: p.procedureDate,
        notes: p.notes,
      })),
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
