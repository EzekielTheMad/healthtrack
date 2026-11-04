import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { hasScope, forbidden } from '@/lib/api-auth';
import { intakeSchema } from '@/lib/fidelity/contracts';
import {
  clinicalReportGrantRequired,
  clinicalBatchReportGrantRequired,
} from '@/lib/fidelity/web-write-grants';
import { requirePat, corsHeaders, fitnessErrorResponse } from '@/lib/api/v1-fitness';
import { readClinicalJson } from '@/lib/fidelity/clinical-http';
import { listClinicalIntakes, stageClinicalIntake } from '@/lib/fidelity/clinical';
const headers = corsHeaders('GET, POST, OPTIONS');
export async function OPTIONS() {
  return new Response(null, { headers });
}
export async function GET(request: NextRequest) {
  const auth = await requirePat(request, 'write:clinical_intake');
  if (auth instanceof Response) return auth;
  try {
    if (
      request.nextUrl.searchParams.has('dependent_id') ||
      request.nextUrl.searchParams.has('owner_id')
    )
      return Response.json({ error: 'PAT intake is self-scoped.' }, { status: 400, headers });
    const allBatches = await listClinicalIntakes(auth.userId, null);
    const batches = hasScope(auth, 'write:clinical_reports')
      ? allBatches
      : allBatches.filter((batch) => !clinicalBatchReportGrantRequired(auth.userId, batch.id));
    return Response.json(
      {
        batches,
        approval: 'The account owner must approve each exact preview in the app.',
      },
      { headers }
    );
  } catch (error) {
    return fitnessErrorResponse(error, headers, '[clinical intake]');
  }
}
export async function POST(request: NextRequest) {
  const auth = await requirePat(request, 'write:clinical_intake');
  if (auth instanceof Response) return auth;
  try {
    const input = intakeSchema.parse(await readClinicalJson(request));
    if (
      clinicalReportGrantRequired(auth.userId, input) &&
      !hasScope(auth, 'write:clinical_reports')
    )
      return forbidden('write:clinical_reports');
    return Response.json(
      await stageClinicalIntake(auth.userId, { ownerId: auth.userId, dependentId: null }, input),
      { status: 201, headers }
    );
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        {
          error: 'Invalid typed clinical intake.',
          issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        { status: 400, headers }
      );
    return fitnessErrorResponse(error, headers, '[clinical intake]');
  }
}
