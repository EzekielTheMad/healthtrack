import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { commitImportBatch, getImportBatch } from '@/lib/import/batches';

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(await getImportBatch(user.id, (await context.params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await requireUser();
    return NextResponse.json(
      await commitImportBatch(user.id, (await context.params).id, await request.json())
    );
  } catch (error) {
    return errorResponse(error);
  }
}
