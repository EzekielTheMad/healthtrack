import { NextRequest } from 'next/server';
import { deepToSnake } from '@/lib/api/snake';
import {
  clampLimit,
  corsHeaders,
  fitnessErrorResponse,
  requirePat,
} from '@/lib/api/v1-fitness';
import { listExerciseHistory } from '@/lib/repos/workouts';

const cors = corsHeaders('GET, OPTIONS');

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}

/**
 * GET /api/v1/exercises/{id}/history?limit — recent entries for one exercise
 * with their session's when/what and derived stats, newest session first
 * (an agent's "latest entry per exercise" in one call). Default 20, max 200.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePat(request, 'read:fitness');
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const limit = clampLimit(request.nextUrl.searchParams.get('limit'), 20, 200);
  try {
    const items = await listExerciseHistory(auth.userId, id, { limit });
    return Response.json(items.map(deepToSnake), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 exercises/[id]/history GET');
  }
}
