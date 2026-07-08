import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { getProfile } from '@/lib/repos/profiles';
import { NotFoundError } from '@/lib/authz';

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
  if (!hasScope(ctx, 'read:profile')) return forbidden('read:profile');

  try {
    const profile = await getProfile(ctx.userId, ctx.userId);

    if (!profile) {
      return Response.json({ error: 'Profile not found' }, { status: 404, headers: corsHeaders });
    }

    // Response shape parity with the legacy PostgREST implementation (same fields).
    return Response.json(
      {
        id: profile.id,
        display_name: profile.displayName,
        date_of_birth: profile.dateOfBirth,
        biological_sex: profile.biologicalSex,
        height_inches: profile.heightInches,
        weight_lbs: profile.weightLbs,
        unit_system: profile.unitSystem,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ error: 'Profile not found' }, { status: 404, headers: corsHeaders });
    }
    const message = error instanceof Error ? error.message : 'Internal error';
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
