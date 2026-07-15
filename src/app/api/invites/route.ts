/**
 * Invite management — ADMIN only.
 *   GET  /api/invites  → list all invites (pending + used)
 *   POST /api/invites  → create one; body { note?, expires_in_days? }
 * The invite URL is derived client-side from window.location.origin so it
 * works no matter what APP_URL the instance runs behind.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import { rowsToSnake, rowToSnake } from '@/lib/api/snake';
import { createInvite, listInvites } from '@/lib/repos/invites';

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'admin') return null;
  return user;
}

export async function GET() {
  try {
    const admin = await requireAdmin();
    if (!admin) return apiError(403, 'forbidden', 'Admin access required');
    return NextResponse.json(rowsToSnake(await listInvites()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (!admin) return apiError(403, 'forbidden', 'Admin access required');
    const body = (await request.json().catch(() => ({}))) as {
      note?: unknown;
      expires_in_days?: unknown;
    };
    const row = await createInvite(admin.id, {
      note: typeof body.note === 'string' ? body.note : null,
      expiresInDays:
        typeof body.expires_in_days === 'number' ? body.expires_in_days : undefined,
    });
    return NextResponse.json(rowToSnake(row), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
