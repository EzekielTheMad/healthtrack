/**
 * /api/workouts/{id} — session-authenticated workout corrections for the UI
 * (the PAT-scoped twin lives at /api/v1/workouts/{id}). Row scope derives
 * from the row itself in the repo; cross-user probes see 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import { deleteWorkout, updateWorkout } from '@/lib/repos/workouts';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH — partial session fields; `entries`, when present, is a FULL
 * replacement (spec §API). Moving started_at onto another session's dedupe
 * tuple → 409 (FitnessConflictError via errorResponse).
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const workout = await updateWorkout(user.id, id, deepBodyToCamel(await request.json()));
    return NextResponse.json(deepToSnake(workout));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE — 204; entries cascade. Owner-only ('delete' access). */
export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    await deleteWorkout(user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
