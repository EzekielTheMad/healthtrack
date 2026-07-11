/**
 * /api/checkins/{weekStart} — session-authenticated weekly check-in for the
 * UI's Weekly tab. weekStart must be a Monday YYYY-MM-DD (400 otherwise).
 *
 * GET supports ?owner_id= delegate scoping (check-ins are strictly per-user);
 * 404 when no row exists yet — the Weekly view prefers the rollup's embedded
 * check-in row and uses this GET only for refreshes.
 *
 * PUT is owner-only (delegates are read-only on the fitness section) and has
 * FULL-replacement semantics: omitted manual fields clear to null. neck_in /
 * waist_in are accepted but written through to vitals, never stored here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import { scopeFromParams } from '@/lib/repos/_scope';
import { getCheckin, upsertCheckin } from '@/lib/repos/checkins';

type Ctx = { params: Promise<{ weekStart: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { weekStart } = await ctx.params;
    const scope = scopeFromParams(user.id, request.nextUrl.searchParams);
    const row = await getCheckin(user.id, scope.ownerId, weekStart);
    if (!row) {
      return apiError(404, 'not_found', `No check-in recorded for week ${weekStart}.`);
    }
    return NextResponse.json(deepToSnake(row));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { weekStart } = await ctx.params;
    const row = await upsertCheckin(
      user.id,
      user.id,
      weekStart,
      deepBodyToCamel(await request.json()),
    );
    return NextResponse.json(deepToSnake(row));
  } catch (error) {
    return errorResponse(error);
  }
}
