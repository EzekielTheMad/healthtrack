import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import { updateLabVisit } from '@/lib/repos/labs';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const visit = await updateLabVisit(user.id, id, deepBodyToCamel(await request.json()));
    return NextResponse.json(deepToSnake(visit));
  } catch (error) {
    return errorResponse(error);
  }
}
