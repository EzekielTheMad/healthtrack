/**
 * DELETE /api/invites/[id] — revoke (or clean up) an invite. Admin only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import { deleteInvite } from '@/lib/repos/invites';

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (user.role !== 'admin') return apiError(403, 'forbidden', 'Admin access required');
    const { id } = await context.params;
    await deleteInvite(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
