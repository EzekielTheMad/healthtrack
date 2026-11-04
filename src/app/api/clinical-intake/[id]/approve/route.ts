import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { errorResponse } from '@/lib/api/respond';
import { approveClinicalIntake } from '@/lib/fidelity/clinical';
import { clinicalOriginAllowed, readClinicalJson } from '@/lib/fidelity/clinical-http';
/** No bearer fallback: this action requires the account owner's browser session. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!clinicalOriginAllowed(request))
      return apiError(
        403,
        'invalid_origin',
        'Approve this exact preview from this HealthTrack site.'
      );
    return NextResponse.json(
      await approveClinicalIntake(
        user.id,
        (await context.params).id,
        await readClinicalJson(request)
      )
    );
  } catch (error) {
    return errorResponse(error);
  }
}
