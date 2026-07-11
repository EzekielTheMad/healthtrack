/**
 * /api/goals — session-authenticated goal listing + creation for the UI
 * (goal-aware coloring and the Goals tab; the PAT-scoped twin lives in
 * /api/v1). GET supports ?active=true|false and ?kind=metric|frequency, plus
 * the standard ?owner_id= delegate scoping. Goals are strictly per-user, so
 * no dependent filter applies.
 *
 * POST creates a goal for the signed-in user only (fitness writes are
 * owner-only — delegates are read-only on the section). A second active goal
 * for the same metricKey/sessionType → 409 (FitnessConflictError).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { deepBodyToCamel, deepToSnake, rowsToSnake } from '@/lib/api/snake';
import { scopeFromParams } from '@/lib/repos/_scope';
import { createGoal, listGoals } from '@/lib/repos/goals';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const params = request.nextUrl.searchParams;
    const scope = scopeFromParams(user.id, params);
    const active = params.get('active');
    const kind = params.get('kind');
    const rows = await listGoals(user.id, scope.ownerId, {
      active: active === null ? undefined : active === 'true',
      kind: kind === 'metric' || kind === 'frequency' ? kind : undefined,
    });
    return NextResponse.json(rowsToSnake(rows));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const row = await createGoal(user.id, user.id, deepBodyToCamel(await request.json()));
    return NextResponse.json(deepToSnake(row), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
