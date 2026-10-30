import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { getHealthTrackTimeZone, calendarDayInTimeZone } from '@/lib/oura/timezone';
import { weekStartOfDayKey } from '@/lib/fitness/weeks';
import { version } from '../../../../package.json';
export async function GET() {
  try {
    await requireUser();
    const timezone = getHealthTrackTimeZone();
    return NextResponse.json(
      {
        version,
        revision: process.env.BUILD_REVISION ?? 'development',
        timezone,
        current_week_start: weekStartOfDayKey(calendarDayInTimeZone(new Date(), timezone)),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
