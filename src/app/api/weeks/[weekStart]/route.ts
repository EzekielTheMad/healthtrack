/**
 * /api/weeks/{weekStart} — session-authenticated weekly rollup for the UI's
 * Weekly tab: sessions by type, body/recovery averages, latest neck/waist,
 * frequency-goal progress, the check-in row, and prior-week deltas. Reuses
 * the shared rollup (src/lib/fitness/rollup.ts) — never reimplemented.
 * Supports ?owner_id= delegate scoping; weeks are strictly per-user.
 * weekStart must be a Monday YYYY-MM-DD (400 otherwise).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { deepToSnake } from '@/lib/api/snake';
import { scopeFromParams } from '@/lib/repos/_scope';
import { getWeekRollup } from '@/lib/fitness/rollup';

type Ctx = { params: Promise<{ weekStart: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { weekStart } = await ctx.params;
    const scope = scopeFromParams(user.id, request.nextUrl.searchParams);
    const rollup = await getWeekRollup(user.id, scope.ownerId, weekStart);
    return NextResponse.json(deepToSnake(rollup));
  } catch (error) {
    return errorResponse(error);
  }
}
