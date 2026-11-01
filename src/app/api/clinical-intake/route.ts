import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { errorResponse } from '@/lib/api/respond';
import { listClinicalIntakes, stageClinicalIntake } from '@/lib/fidelity/clinical';
import { clinicalOriginAllowed, readClinicalJson } from '@/lib/fidelity/clinical-http';
const inputSchema = z
  .object({ dependent_id: z.string().min(1).nullable().optional(), intake: z.unknown() })
  .strict();
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    return NextResponse.json(
      await listClinicalIntakes(user.id, request.nextUrl.searchParams.get('dependent_id') || null)
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    if (!clinicalOriginAllowed(request))
      return apiError(403, 'invalid_origin', 'Open this preview from this HealthTrack site.');
    const input = inputSchema.parse(await readClinicalJson(request));
    return NextResponse.json(
      await stageClinicalIntake(
        user.id,
        { ownerId: user.id, dependentId: input.dependent_id ?? null },
        input.intake
      ),
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
