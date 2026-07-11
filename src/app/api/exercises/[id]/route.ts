/**
 * /api/exercises/{id} — session-authenticated catalog edits for the UI's
 * unreviewed-exercises cleanup card (rename / alias / confirm → PATCH).
 * Resolution-uniqueness collisions surface as 400 (FitnessWriteError).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import { updateExercise } from '@/lib/repos/exercises';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const row = await updateExercise(user.id, id, deepBodyToCamel(await request.json()));
    return NextResponse.json(deepToSnake(row));
  } catch (error) {
    return errorResponse(error);
  }
}
