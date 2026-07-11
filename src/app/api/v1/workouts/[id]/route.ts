import { NextRequest } from 'next/server';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import {
  corsHeaders,
  fitnessErrorResponse,
  readJsonBody,
  requirePat,
} from '@/lib/api/v1-fitness';
import { deleteWorkout, getWorkout, updateWorkout } from '@/lib/repos/workouts';

const cors = corsHeaders('GET, PATCH, DELETE, OPTIONS');

type Ctx = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}

/** GET /api/v1/workouts/{id} — one session with nested entries. Cross-user
    probes see 404 (ownership-scoped lookups). */
export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await requirePat(request, 'read:fitness');
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  try {
    const workout = await getWorkout(auth.userId, id);
    return Response.json(deepToSnake(workout), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 workouts/[id] GET');
  }
}

/**
 * PATCH /api/v1/workouts/{id} — partial session fields; `entries`, when
 * present, is a FULL replacement. Moving started_at onto another session's
 * dedupe tuple → 409 naming the existing session (`existing_id`).
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requirePat(request, 'write:fitness');
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const parsed = await readJsonBody(request, cors);
  if (!parsed.ok) return parsed.response;
  try {
    const workout = await updateWorkout(auth.userId, id, deepBodyToCamel(parsed.body));
    return Response.json(deepToSnake(workout), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 workouts/[id] PATCH');
  }
}

/** DELETE /api/v1/workouts/{id} — 204; entries cascade. */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = await requirePat(request, 'write:fitness');
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  try {
    await deleteWorkout(auth.userId, id);
    return new Response(null, { status: 204, headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 workouts/[id] DELETE');
  }
}
