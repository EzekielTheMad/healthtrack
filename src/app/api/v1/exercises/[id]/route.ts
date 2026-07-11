import { NextRequest } from 'next/server';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import {
  corsHeaders,
  fitnessErrorResponse,
  readJsonBody,
  requirePat,
} from '@/lib/api/v1-fitness';
import { updateExercise } from '@/lib/repos/exercises';

const cors = corsHeaders('PATCH, OPTIONS');

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}

/** PATCH /api/v1/exercises/{id} — edit name/variant/mode/aliases/review_status
    (the unreviewed-cleanup path). Resolution uniqueness re-checked on rename. */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePat(request, 'write:fitness');
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const parsed = await readJsonBody(request, cors);
  if (!parsed.ok) return parsed.response;
  try {
    const row = await updateExercise(auth.userId, id, deepBodyToCamel(parsed.body));
    return Response.json(deepToSnake(row), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 exercises/[id] PATCH');
  }
}
