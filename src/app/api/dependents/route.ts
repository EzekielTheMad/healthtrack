/**
 * /api/dependents — owner-only dependent management (replaces the client's
 * direct PostgREST `dependents` queries and the legacy route).
 * Wire shapes preserved: PATCH takes { id, ...updates }, DELETE takes ?id=,
 * both mutations respond with the row / { success: true }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import { bodyToCamel, rowToSnake, rowsToSnake } from '@/lib/api/snake';
import {
  createDependent,
  deleteDependent,
  listDependents,
  updateDependent,
} from '@/lib/repos/dependents';

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await listDependents(user.id);
    return NextResponse.json(rowsToSnake(rows));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = bodyToCamel(await request.json());
    const row = await createDependent(user.id, body);
    return NextResponse.json(rowToSnake(row), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const { id, ...updates } = bodyToCamel(await request.json());
    if (!id || typeof id !== 'string') {
      return apiError(400, 'validation_error', 'Dependent id is required');
    }
    const row = await updateDependent(user.id, id, updates);
    return NextResponse.json(rowToSnake(row));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return apiError(400, 'validation_error', 'Dependent id is required');
    }
    await deleteDependent(user.id, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
