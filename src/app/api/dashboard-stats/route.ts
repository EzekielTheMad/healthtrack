/**
 * /api/dashboard-stats — dashboard stat preferences (owner-only domain).
 *
 * GET  ?dependent_id=<id>  → { preferences, source_count, available_lab_tests }
 *      (source_count / available_lab_tests reproduce the reads the hook used
 *       to make directly against connected_sources / lab_results)
 * POST { dependent_id?, items: [{ widget_type, metric_key, position, ... }] }
 *      → bulk insert, returns created rows
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import {
  createDashboardPrefs,
  getDashboardExtras,
  listDashboardPrefs,
} from '@/lib/repos/dashboard-prefs';
import { errorResponse } from '@/lib/api/respond';
import { bodyToCamel, rowsToSnake } from '@/lib/api/snake';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const dependentId = request.nextUrl.searchParams.get('dependent_id');
    const [preferences, extras] = await Promise.all([
      listDashboardPrefs(user.id, dependentId),
      getDashboardExtras(user.id),
    ]);
    return NextResponse.json({
      preferences: rowsToSnake(preferences),
      source_count: extras.sourceCount,
      available_lab_tests: extras.availableLabTests.map((t) => ({
        test_name: t.testName,
        unit: t.unit,
        latest_value: t.latestValue,
        flag: t.flag,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const raw = (await request.json()) as { dependent_id?: unknown; items?: unknown };
    const dependentId =
      typeof raw?.dependent_id === 'string' && raw.dependent_id ? raw.dependent_id : null;
    const items = Array.isArray(raw?.items) ? raw.items.map(bodyToCamel) : raw?.items;
    const rows = await createDashboardPrefs(user.id, dependentId, items);
    return NextResponse.json(rowsToSnake(rows), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
