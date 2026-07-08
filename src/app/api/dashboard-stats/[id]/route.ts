/**
 * /api/dashboard-stats/[id] — PATCH (position/pinned/visible), DELETE.
 * Owner-only; cross-user probes get 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { deleteDashboardPref, updateDashboardPref } from '@/lib/repos/dashboard-prefs';
import { errorResponse } from '@/lib/api/respond';
import { bodyToCamel, rowToSnake } from '@/lib/api/snake';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const patch = bodyToCamel(await request.json());
    const row = await updateDashboardPref(user.id, id, patch);
    return NextResponse.json(rowToSnake(row));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    await deleteDashboardPref(user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
