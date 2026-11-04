import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey, unauthorized, forbidden } from '@/lib/api-auth';
import { buildHealthContext, contextDaysSchema } from '@/lib/health-context';
import { errorResponse } from '@/lib/api/respond';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};
export function OPTIONS() {
  return new Response(null, { headers });
}
export async function GET(request: NextRequest) {
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  if (!ctx.scopes.includes('read:all')) return forbidden('read:all');
  try {
    const days = contextDaysSchema.parse(request.nextUrl.searchParams.get('days') ?? 90);
    return NextResponse.json(await buildHealthContext(ctx.userId, null, days), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
