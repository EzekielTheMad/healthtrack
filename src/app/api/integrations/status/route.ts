import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { listIntegrationHealth } from '@/lib/repos/integration-health';

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await listIntegrationHealth(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
