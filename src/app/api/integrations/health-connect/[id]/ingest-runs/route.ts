/**
 * GET /api/integrations/health-connect/{id}/ingest-runs?limit=
 *
 * Delivery history for the integration screen: per-payload counts, backfill
 * windows, normalization summaries and recent errors.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { rowsToSnake } from '@/lib/api/snake';
import { listIngestRuns } from '@/lib/repos/health-connect';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = parseInt(request.nextUrl.searchParams.get('limit') ?? '', 10);
    const runs = await listIngestRuns(user.id, id, Number.isNaN(parsed) ? 20 : parsed);
    return NextResponse.json(rowsToSnake(runs));
  } catch (error) {
    return errorResponse(error);
  }
}
