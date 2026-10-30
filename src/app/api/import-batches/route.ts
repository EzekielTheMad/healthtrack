import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { listImportBatches } from '@/lib/import/batches';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    return NextResponse.json(
      await listImportBatches(user.id, request.nextUrl.searchParams.get('dependent_id') || null)
    );
  } catch (error) {
    return errorResponse(error);
  }
}
