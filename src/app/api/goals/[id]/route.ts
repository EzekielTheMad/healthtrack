/**
 * /api/goals/{id} — session-authenticated goal edits for the UI's Goals tab
 * (active toggles, retargeting). Kind is immutable; activating into an
 * existing active metricKey/sessionType slot → 409 (FitnessConflictError via
 * errorResponse). Row scope derives from the row; cross-user probes see 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import { updateGoal } from '@/lib/repos/goals';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const row = await updateGoal(user.id, id, deepBodyToCamel(await request.json()));
    return NextResponse.json(deepToSnake(row));
  } catch (error) {
    return errorResponse(error);
  }
}
