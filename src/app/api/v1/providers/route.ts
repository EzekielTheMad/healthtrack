import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listProviders } from '@/lib/repos/providers';

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
  if (!hasScope(ctx, 'read:providers')) return forbidden('read:providers');

  try {
    // PAT scope: the key owner's own data, dependent_id NULL (parity with the
    // legacy PostgREST implementation). Ordered favorites first, then name.
    const rows = await listProviders(ctx.userId, {
      ownerId: ctx.userId,
      dependentId: null,
    });

    // Response shape parity: same field list as the legacy PostgREST select.
    return Response.json(
      rows.map((p) => ({
        id: p.id,
        name: p.name,
        provider_type: p.providerType,
        specialty: p.specialty,
        organization: p.organization,
        phone: p.phone,
        address: p.address,
        portal_url: p.portalUrl,
        is_favorite: p.isFavorite,
      })),
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
