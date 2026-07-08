/**
 * /api/labs — session-authenticated lab visits with nested results (replaces
 * the client's direct PostgREST `lab_visits.select('*, lab_results(*)')`).
 * POST creates a visit plus its results (lab PDF import flow); the PDF itself
 * is stored by /api/parse-lab-pdf via src/lib/storage and served by /api/files.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { bodyToCamel, rowToSnake, rowsToSnake } from '@/lib/api/snake';
import { createScopeFromBody, scopeFromParams } from '@/lib/repos/_scope';
import {
  createLabVisitWithResults,
  listLabVisitsWithResults,
  type LabVisitWithResults,
} from '@/lib/repos/labs';

/** Visit row → snake JSON with the nested results array converted too. */
function visitToSnake(visit: LabVisitWithResults): Record<string, unknown> {
  const { labResults, ...row } = visit;
  return { ...rowToSnake(row), lab_results: rowsToSnake(labResults) };
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const params = request.nextUrl.searchParams;
    const visits = await listLabVisitsWithResults(
      user.id,
      scopeFromParams(user.id, params),
    );
    return NextResponse.json(visits.map(visitToSnake));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = bodyToCamel(await request.json());
    // nested results arrive snake_case; convert each row (bodyToCamel is shallow)
    const results = Array.isArray(body.results)
      ? (body.results as unknown[]).map(bodyToCamel)
      : [];
    const scope = createScopeFromBody(user.id, body);
    const visit = await createLabVisitWithResults(user.id, scope, {
      ...body,
      results,
    });
    return NextResponse.json(visitToSnake(visit), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
