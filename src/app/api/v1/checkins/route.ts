import { NextRequest } from 'next/server';
import { deepToSnake } from '@/lib/api/snake';
import {
  clampLimit,
  corsHeaders,
  fitnessErrorResponse,
  requirePat,
} from '@/lib/api/v1-fitness';
import { listCheckins } from '@/lib/repos/checkins';

const cors = corsHeaders('GET, OPTIONS');

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}

/** GET /api/v1/checkins?from&to&limit — weekly check-ins, week_start
    descending. Bounds compare against the Monday `YYYY-MM-DD` week keys. */
export async function GET(request: NextRequest) {
  const auth = await requirePat(request, 'read:fitness');
  if (auth instanceof Response) return auth;
  const { searchParams } = request.nextUrl;
  try {
    const rows = await listCheckins(auth.userId, auth.userId, {
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      limit: clampLimit(searchParams.get('limit'), 100, 500),
    });
    return Response.json(rows.map(deepToSnake), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 checkins GET');
  }
}
