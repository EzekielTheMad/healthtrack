import { NextRequest } from 'next/server';
import { SESSION_TYPES, type SessionType } from '@/db/schema';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import {
  clampLimit,
  corsHeaders,
  fitnessErrorResponse,
  inclusiveDayUpperBound,
  readJsonBody,
  requirePat,
} from '@/lib/api/v1-fitness';
import { createWorkout, listWorkouts } from '@/lib/repos/workouts';

const cors = corsHeaders('GET, POST, OPTIONS');

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}

/**
 * GET /api/v1/workouts?from&to&type&label&limit — sessions with nested
 * entries (resolved exercise name+variant, sets, derived working weight /
 * top reps), started_at descending. PAT self-scope: the key owner's own
 * sessions, dependent_id NULL.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePat(request, 'read:fitness');
  if (auth instanceof Response) return auth;

  const { searchParams } = request.nextUrl;
  const type = searchParams.get('type');
  if (type !== null && !(SESSION_TYPES as readonly string[]).includes(type)) {
    return Response.json(
      { error: `Unknown type '${type}' — must be one of: ${SESSION_TYPES.join(', ')}.` },
      { status: 400, headers: cors },
    );
  }
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to');
  const label = searchParams.get('label') ?? undefined;
  const limit = clampLimit(searchParams.get('limit'), 100, 500);

  try {
    const workouts = await listWorkouts(
      auth.userId,
      { ownerId: auth.userId, dependentId: null },
      {
        from,
        to: to === null ? undefined : inclusiveDayUpperBound(to),
        type: (type as SessionType | null) ?? undefined,
        label,
        limit,
      },
    );
    return Response.json(workouts.map(deepToSnake), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 workouts GET');
  }
}

/**
 * POST /api/v1/workouts — session + nested entries in one call. Exercise
 * names resolve via the catalog (name + aliases, case-insensitive); unknown
 * names auto-create `unreviewed` entries. 201 with the created workout, or
 * 409 with the EXISTING workout when (user, started_at) already has a session
 * (agent dedupe backstop).
 */
export async function POST(request: NextRequest) {
  const auth = await requirePat(request, 'write:fitness');
  if (auth instanceof Response) return auth;

  const parsed = await readJsonBody(request, cors);
  if (!parsed.ok) return parsed.response;

  try {
    const { created, workout } = await createWorkout(
      auth.userId,
      { ownerId: auth.userId, dependentId: null },
      deepBodyToCamel(parsed.body),
    );
    if (!created) {
      return Response.json(
        {
          error: `A workout session already exists at started_at '${workout.startedAt}'.`,
          workout: deepToSnake(workout),
        },
        { status: 409, headers: cors },
      );
    }
    return Response.json(deepToSnake(workout), { status: 201, headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 workouts POST');
  }
}
