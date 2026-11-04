import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { getTypedLabEvidence } from '@/lib/fidelity/clinical-extraction';
/** Source-document access remains owner-only, independent of value read grants. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    return NextResponse.json(await getTypedLabEvidence(user.id, (await context.params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
