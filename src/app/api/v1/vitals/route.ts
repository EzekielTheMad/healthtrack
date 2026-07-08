import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listVitals } from '@/lib/repos/vitals';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const ctx = await validateApiKey(authHeader);
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, 'read:vitals')) return forbidden('read:vitals');

  const { searchParams } = request.nextUrl;
  const metric = searchParams.get('metric');
  const days = parseInt(searchParams.get('days') ?? '0', 10) || null;
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 1000);

  let startDate: string | undefined;
  if (days && days > 0) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    startDate = since.toISOString();
  }

  try {
    // PAT scope: the key owner's own data, dependent_id NULL, recorded_at
    // desc — parity with the legacy PostgREST implementation.
    const rows = await listVitals(
      ctx.userId,
      { ownerId: ctx.userId, dependentId: null },
      { metricKey: metric ?? undefined, startDate, limit },
    );

    // Response shape byte-identical to the legacy PostgREST select: same fields,
    // same key order.
    return Response.json(
      rows.map((v) => ({
        id: v.id,
        metric_key: v.metricKey,
        value: v.value,
        unit: v.unit,
        source: v.source,
        recorded_at: v.recordedAt,
      })),
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
