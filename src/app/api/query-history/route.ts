/**
 * GET /api/query-history — the signed-in user's AI query log (replaces the
 * client's direct PostgREST `query_history` read; owner-only).
 */
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { rowsToSnake } from '@/lib/api/snake';
import { apiError } from '@/lib/api-error';
import { OWNER_AI_ONLY_MESSAGE, supportsOwnerAiContext } from '@/lib/claude/owner-context';
import { listQueryHistory } from '@/lib/repos/query-history';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!supportsOwnerAiContext(user.id, new URL(request.url).searchParams)) {
      return apiError(400, 'unsupported_context', OWNER_AI_ONLY_MESSAGE);
    }
    const rows = await listQueryHistory(user.id);
    return NextResponse.json(rowsToSnake(rows));
  } catch (error) {
    return errorResponse(error);
  }
}
