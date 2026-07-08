/**
 * PATCH /api/interaction-alerts/[id] — dismiss an alert. Owner-only; a
 * non-owner dismiss is a silent no-op success (RLS parity — the PostgREST
 * update matched 0 rows and still reported success).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { dismissInteractionAlert } from '@/lib/repos/interaction-alerts';

export async function PATCH(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    await dismissInteractionAlert(user.id, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
