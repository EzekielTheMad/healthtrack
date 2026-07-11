import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { db } from '@/db';
import { bodyToCamel } from '@/lib/api/snake';
import { inclusiveDayUpperBound } from '@/lib/api/v1-fitness';
import {
  findOwnVital,
  listVitals,
  upsertOwnVital,
  validateVitalWrite,
  VitalWriteError,
} from '@/lib/repos/vitals';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  // Clamp to [1, 1000] — negative/zero values must not become "unlimited"
  // (SQLite treats LIMIT -1 as no limit).
  const rawLimit = parseInt(searchParams.get('limit') ?? '', 10);
  const limit = Math.min(Math.max(1, Number.isNaN(rawLimit) ? 100 : rawLimit), 1000);

  // Explicit series window (fitness-domain read API): inclusive ISO day or
  // datetime bounds. `from` wins over the legacy `days` shorthand.
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  let startDate: string | undefined;
  if (from) {
    startDate = from;
  } else if (days && days > 0) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    startDate = since.toISOString();
  }
  // A plain-day `to` means "through the end of that day" against the
  // ISO-timestamp recorded_at column.
  const endDate = to ? inclusiveDayUpperBound(to) : undefined;

  try {
    // PAT scope: the key owner's own data, dependent_id NULL, recorded_at
    // desc — parity with the legacy PostgREST implementation.
    const rows = await listVitals(
      ctx.userId,
      { ownerId: ctx.userId, dependentId: null },
      { metricKey: metric ?? undefined, startDate, endDate, limit },
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
    // Never reflect internal error details to API clients (respond.ts policy).
    console.error('v1 vitals GET error:', error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}

/**
 * POST /api/v1/vitals — single-record registry-validated upsert, keyed on
 * (user, metric_key, recorded_at, source). Self-scope only: rows are always
 * written for the token's owner (dependent_id NULL).
 *
 * Body: { metric_key, value?, value_label?, unit?, recorded_at, source, metadata? }
 * 201:  { result: 'inserted' | 'updated', vital: {...} }
 */
export async function POST(request: NextRequest) {
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, 'write:vitals')) return forbidden('write:vitals');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Request body must be valid JSON' },
      { status: 400, headers: corsHeaders },
    );
  }

  try {
    const record = validateVitalWrite(bodyToCamel(body));
    const result = upsertOwnVital(db, ctx.userId, record);
    const row = findOwnVital(db, ctx.userId, record);
    return Response.json(
      {
        result,
        vital: row && {
          id: row.id,
          metric_key: row.metricKey,
          value: row.value,
          unit: row.unit,
          source: row.source,
          recorded_at: row.recordedAt,
          metadata: row.metadata,
        },
      },
      { status: 201, headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof VitalWriteError) {
      return Response.json({ error: error.message }, { status: 400, headers: corsHeaders });
    }
    // Never reflect internal error details to API clients (respond.ts policy).
    console.error('v1 vitals POST error:', error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}
