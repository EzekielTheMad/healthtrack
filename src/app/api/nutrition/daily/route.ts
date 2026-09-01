/**
 * GET /api/nutrition/daily — session-authenticated daily nutrition totals for
 * the in-app view. Same canonical snapshot table as the v1 endpoint; reads
 * never touch the raw webhook history.
 *
 * Query: ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&limit=
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { rowsToSnake } from '@/lib/api/snake';
import { listNutritionDaily } from '@/lib/repos/nutrition';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = request.nextUrl;
    const parsed = parseInt(searchParams.get('limit') ?? '', 10);
    const rows = await listNutritionDaily(user.id, {
      startDate: searchParams.get('start_date') ?? undefined,
      endDate: searchParams.get('end_date') ?? undefined,
      limit: Number.isNaN(parsed) ? undefined : parsed,
    });
    return NextResponse.json(rowsToSnake(rows));
  } catch (error) {
    return errorResponse(error);
  }
}
