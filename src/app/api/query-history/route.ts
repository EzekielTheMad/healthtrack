/**
 * GET /api/query-history — the signed-in user's AI query log (replaces the
 * client's direct PostgREST `query_history` read; owner-only).
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { rowsToSnake } from '@/lib/api/snake';
import { listQueryHistory } from '@/lib/repos/query-history';
import { CONTEXT_VERSION } from '@/lib/health-context';

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await listQueryHistory(user.id);
    const trusted = rows.filter(
      (row) =>
        row.contextMetadata?.context_version === CONTEXT_VERSION &&
        row.contextMetadata.dependent_id === (row.dependentId ?? null)
    );
    return NextResponse.json(rowsToSnake(trusted));
  } catch (error) {
    return errorResponse(error);
  }
}
