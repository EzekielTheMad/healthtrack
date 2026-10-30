import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { buildDoctorSummary } from '@/lib/doctor-summary';
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const summary = await buildDoctorSummary(
      user.id,
      request.nextUrl.searchParams.get('dependent_id')
    );
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
