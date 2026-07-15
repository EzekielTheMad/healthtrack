/**
 * GET /api/interaction-alerts — the interaction status for a scope:
 *   { alerts, status, snoozed_count }
 * `alerts` are the currently un-snoozed alerts; `status` is the latest check
 * outcome (so the UI can show "no interactions found" vs "never checked");
 * `snoozed_count` is how many alerts are temporarily hidden. Scope params
 * mirror the hooks: ?owner_id= (delegate mode) returns empty — interaction data
 * is owner-only, RLS parity — and ?dependent_id= filters exactly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { rowsToSnake } from '@/lib/api/snake';
import { scopeFromParams } from '@/lib/repos/_scope';
import {
  listActiveInteractionAlerts,
  getInteractionCheck,
  countSnoozedInteractionAlerts,
} from '@/lib/repos/interaction-alerts';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const scope = scopeFromParams(user.id, request.nextUrl.searchParams);
    const [rows, status, snoozedCount] = await Promise.all([
      listActiveInteractionAlerts(user.id, scope),
      getInteractionCheck(user.id, scope),
      countSnoozedInteractionAlerts(user.id, scope),
    ]);
    return NextResponse.json({
      alerts: rowsToSnake(rows),
      status: status
        ? { checked_at: status.checkedAt, has_interactions: status.hasInteractions }
        : null,
      snoozed_count: snoozedCount,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
