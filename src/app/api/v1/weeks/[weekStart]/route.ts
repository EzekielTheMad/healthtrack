import { NextRequest } from 'next/server';
import { deepToSnake } from '@/lib/api/snake';
import { corsHeaders, fitnessErrorResponse, requirePat } from '@/lib/api/v1-fitness';
import { getWeekRollup } from '@/lib/fitness/rollup';

const cors = corsHeaders('GET, OPTIONS');

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}

/**
 * GET /api/v1/weeks/{weekStart} — the computed weekly rollup (fitness design
 * spec §API): sessions by type with labels, weigh-in aggregates + days
 * weighed, body-composition and recovery averages over the days that exist,
 * latest neck/waist, active frequency-goal progress, the check-in row, and
 * prior-week deltas. Nothing is stored; every call recomputes from source
 * rows. weekStart must be a Monday `YYYY-MM-DD` (400 otherwise) — weeks are
 * Monday-anchored in the owner's timezone (see src/lib/fitness/rollup.ts).
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ weekStart: string }> }) {
  const auth = await requirePat(request, 'read:fitness');
  if (auth instanceof Response) return auth;
  const { weekStart } = await ctx.params;
  try {
    const rollup = await getWeekRollup(auth.userId, auth.userId, weekStart);
    return Response.json(deepToSnake(rollup), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 weeks/[weekStart] GET');
  }
}
