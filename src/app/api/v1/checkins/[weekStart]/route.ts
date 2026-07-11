import { NextRequest } from 'next/server';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import {
  corsHeaders,
  fitnessErrorResponse,
  readJsonBody,
  requirePat,
} from '@/lib/api/v1-fitness';
import { getCheckin, upsertCheckin } from '@/lib/repos/checkins';

const cors = corsHeaders('GET, PUT, OPTIONS');

type Ctx = { params: Promise<{ weekStart: string }> };

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}

/** GET /api/v1/checkins/{weekStart} — one week's check-in. weekStart must be
    a Monday `YYYY-MM-DD` (400 otherwise); 404 when no row exists yet. */
export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await requirePat(request, 'read:fitness');
  if (auth instanceof Response) return auth;
  const { weekStart } = await ctx.params;
  try {
    const row = await getCheckin(auth.userId, auth.userId, weekStart);
    if (!row) {
      return Response.json(
        { error: `No check-in recorded for week ${weekStart}.` },
        { status: 404, headers: cors },
      );
    }
    return Response.json(deepToSnake(row), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 checkins/[weekStart] GET');
  }
}

/**
 * PUT /api/v1/checkins/{weekStart} — upsert the manual fields (full
 * replacement: omitted fields clear to null). `neck_in`/`waist_in` are
 * accepted but written through to vitals (metric neck/waist, source manual,
 * recorded on the submission day), never stored on the check-in row.
 */
export async function PUT(request: NextRequest, ctx: Ctx) {
  const auth = await requirePat(request, 'write:fitness');
  if (auth instanceof Response) return auth;
  const { weekStart } = await ctx.params;
  const parsed = await readJsonBody(request, cors);
  if (!parsed.ok) return parsed.response;
  try {
    const row = await upsertCheckin(
      auth.userId,
      auth.userId,
      weekStart,
      deepBodyToCamel(parsed.body),
    );
    return Response.json(deepToSnake(row), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 checkins/[weekStart] PUT');
  }
}
