import { NextRequest } from 'next/server';
import { requirePat, corsHeaders, fitnessErrorResponse } from '@/lib/api/v1-fitness';
import { getClinicalIntake } from '@/lib/fidelity/clinical';
const headers = corsHeaders('GET, OPTIONS');
export async function OPTIONS() {
  return new Response(null, { headers });
}
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePat(request, 'write:clinical_intake');
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await getClinicalIntake(auth.userId, (await context.params).id, true), {
      headers,
    });
  } catch (error) {
    return fitnessErrorResponse(error, headers, '[clinical intake]');
  }
}
