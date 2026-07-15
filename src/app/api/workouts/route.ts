/**
 * /api/workouts — session-authenticated workout listing + manual logging for
 * the UI (the PAT-scoped twins live in /api/v1). GET supports ?from= / ?to=
 * (inclusive started_at bounds) and ?type=, plus the standard owner_id /
 * dependent_id scope params. The Focus view uses this for frequency-goal
 * week progress.
 *
 * POST mirrors POST /api/v1/workouts: session + nested entries in one call,
 * exercise names resolved via the catalog (unknown names auto-create
 * `unreviewed`), 201 with the created workout, or 409 when
 * (user, started_at, dependent) already has a session (dedupe backstop).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import { createScopeFromBody, scopeFromParams } from '@/lib/repos/_scope';
import { createWorkout, listWorkouts } from '@/lib/repos/workouts';
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

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = deepBodyToCamel(await request.json()) as Record<string, unknown>;
    // Scope mirrors the hooks' insert payloads (owner_id in delegate mode,
    // dependent_id for an active dependent profile); the workout schema
    // strips the scope keys, so passing the whole body through is safe.
    const scope = createScopeFromBody(user.id, body);
    const { created, workout } = await createWorkout(user.id, scope, body);
    if (!created) {
      return apiError(
        409,
        'conflict',
        `A workout session already exists at started_at '${workout.startedAt}'.`,
      );
    }
    return NextResponse.json(deepToSnake(workout), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
