/**
 * /api/exercises/{id}/history — session-authenticated recent entries for one
 * exercise (the trends view's data source): entry + derived stats + the
 * owning session's when/what, newest session first. ?limit= clamped to 200.
 * Ownership comes from the catalog row; cross-user probes see 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { deepToSnake } from '@/lib/api/snake';
import { listExerciseHistory } from '@/lib/repos/workouts';

type Ctx = { params: Promise<{ id: string }> };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const raw = parseInt(request.nextUrl.searchParams.get('limit') ?? '', 10);
    const limit = Math.min(Math.max(1, Number.isNaN(raw) ? DEFAULT_LIMIT : raw), MAX_LIMIT);
    const items = await listExerciseHistory(user.id, id, { limit });
    return NextResponse.json(deepToSnake(items));
  } catch (error) {
    return errorResponse(error);
  }
}
