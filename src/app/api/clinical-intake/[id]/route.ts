import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { errorResponse } from '@/lib/api/respond';
import { getClinicalIntake, reviseClinicalIntake } from '@/lib/fidelity/clinical';
import { clinicalOriginAllowed, readClinicalJson } from '@/lib/fidelity/clinical-http';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await getClinicalIntake(user.id, (await context.params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    if (!clinicalOriginAllowed(request))
      return apiError(403, 'invalid_origin', 'Open this preview from this HealthTrack site.');
    return NextResponse.json(
      await reviseClinicalIntake(
        user.id,
        (await context.params).id,
        await readClinicalJson(request)
      )
    );
  } catch (error) {
    return errorResponse(error);
  }
}
