import { NextRequest } from 'next/server';
import { GOAL_KINDS, type GoalKind } from '@/db/schema';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import {
  corsHeaders,
  fitnessErrorResponse,
  readJsonBody,
  requirePat,
} from '@/lib/api/v1-fitness';
import { createGoal, listGoals } from '@/lib/repos/goals';

const cors = corsHeaders('GET, POST, OPTIONS');

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}

/** GET /api/v1/goals?active&kind — goal list, newest first. */
export async function GET(request: NextRequest) {
  const auth = await requirePat(request, 'read:fitness');
  if (auth instanceof Response) return auth;

  const { searchParams } = request.nextUrl;
  const active = searchParams.get('active');
  if (active !== null && active !== 'true' && active !== 'false') {
    return Response.json(
      { error: "active must be 'true' or 'false'." },
      { status: 400, headers: cors },
    );
  }
  const kind = searchParams.get('kind');
  if (kind !== null && !(GOAL_KINDS as readonly string[]).includes(kind)) {
    return Response.json(
      { error: `Unknown kind '${kind}' — must be one of: ${GOAL_KINDS.join(', ')}.` },
      { status: 400, headers: cors },
    );
  }

  try {
    const rows = await listGoals(auth.userId, auth.userId, {
      active: active === null ? undefined : active === 'true',
      kind: (kind as GoalKind | null) ?? undefined,
    });
    return Response.json(rows.map(deepToSnake), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 goals GET');
  }
}

/**
 * POST /api/v1/goals — create a metric goal ({ kind: "metric", metric_key,
 * direction, target_value?, target_date? }) or frequency goal ({ kind:
 * "frequency", session_type, per_week }). At most one ACTIVE metric goal per
 * metric_key and one ACTIVE frequency goal per session_type — violations
 * return 409 with `existing_id`.
 */
export async function POST(request: NextRequest) {
  const auth = await requirePat(request, 'write:fitness');
  if (auth instanceof Response) return auth;
  const parsed = await readJsonBody(request, cors);
  if (!parsed.ok) return parsed.response;
  try {
    const row = await createGoal(auth.userId, auth.userId, deepBodyToCamel(parsed.body));
    return Response.json(deepToSnake(row), { status: 201, headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 goals POST');
  }
}
