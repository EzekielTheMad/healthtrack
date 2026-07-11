/**
 * /api/workouts — session-authenticated workout listing for the UI (GET
 * only; workout writes live in the PAT-scoped /api/v1 surface). Supports
 * ?from= / ?to= (inclusive started_at bounds) and ?type=, plus the standard
 * owner_id / dependent_id scope params. The Focus view uses this for
 * frequency-goal week progress.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { deepToSnake } from '@/lib/api/snake';
import { scopeFromParams } from '@/lib/repos/_scope';
import { listWorkouts } from '@/lib/repos/workouts';
import { SESSION_TYPES, type SessionType } from '@/db/schema';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const params = request.nextUrl.searchParams;
    const type = params.get('type');
    const rows = await listWorkouts(user.id, scopeFromParams(user.id, params), {
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      type: SESSION_TYPES.includes(type as SessionType) ? (type as SessionType) : undefined,
    });
    // Deep conversion — workout reads nest entries/sets (fitness convention).
    return NextResponse.json(deepToSnake(rows));
  } catch (error) {
    return errorResponse(error);
  }
}
