import { NextRequest } from 'next/server';
import { hasScope, forbidden } from '@/lib/api-auth';
import { clinicalBatchReportGrantRequired } from '@/lib/fidelity/web-write-grants';
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
    const id = (await context.params).id;
    if (
      clinicalBatchReportGrantRequired(auth.userId, id) &&
      !hasScope(auth, 'write:clinical_reports')
    )
      return forbidden('write:clinical_reports');
    return Response.json(await getClinicalIntake(auth.userId, id, true), {
      headers,
    });
  } catch (error) {
    return fitnessErrorResponse(error, headers, '[clinical intake]');
  }
}
