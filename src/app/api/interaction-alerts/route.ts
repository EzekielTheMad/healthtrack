/**
 * GET /api/interaction-alerts — active (non-dismissed) interaction alerts
 * (replaces the client's direct PostgREST read). Scope params mirror the
 * hooks: ?owner_id= (delegate mode) returns [] — interaction_alerts is
 * owner-only, RLS parity — and ?dependent_id= filters exactly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { rowsToSnake } from '@/lib/api/snake';
import { scopeFromParams } from '@/lib/repos/_scope';
import { listActiveInteractionAlerts } from '@/lib/repos/interaction-alerts';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const scope = scopeFromParams(user.id, request.nextUrl.searchParams);
    const rows = await listActiveInteractionAlerts(user.id, scope);
    return NextResponse.json(rowsToSnake(rows));
  } catch (error) {
    return errorResponse(error);
  }
}
