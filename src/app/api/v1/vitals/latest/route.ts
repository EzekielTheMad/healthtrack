import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { getMetric } from '@/lib/metrics/registry';
import { listVitals, type VitalRow } from '@/lib/repos/vitals';

const MAX_METRICS = 25;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

function toWire(v: VitalRow) {
  return {
    id: v.id,
    metric_key: v.metricKey,
    value: v.value,
    unit: v.unit,
    source: v.source,
    recorded_at: v.recordedAt,
  };
}

/**
 * GET /api/v1/vitals/latest?metrics=a,b,c — the newest reading per requested
 * metric in one call (agent anomaly-watch / recap jobs). Response
 * is an object keyed by metric_key; metrics with no data map to null. Metric
 * keys must exist in the closed registry (400 otherwise). PAT self-scope:
 * the key owner's own rows, dependent_id NULL.
 */
export async function GET(request: NextRequest) {
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, 'read:vitals')) return forbidden('read:vitals');

  const raw = request.nextUrl.searchParams.get('metrics');
  const metrics = (raw ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  if (metrics.length === 0) {
    return Response.json(
      { error: 'metrics is required — a comma-separated list of metric keys, e.g. ?metrics=weight,hrv_rmssd' },
      { status: 400, headers: corsHeaders },
    );
  }
  if (metrics.length > MAX_METRICS) {
    return Response.json(
      { error: `At most ${MAX_METRICS} metrics per request (got ${metrics.length}).` },
      { status: 400, headers: corsHeaders },
    );
  }
  const unknown = metrics.filter((m) => !getMetric(m));
  if (unknown.length > 0) {
    return Response.json(
      {
        error: `Unknown metric key${unknown.length > 1 ? 's' : ''} '${unknown.join("', '")}'. The metric registry is closed — see /docs/api for the list of supported metrics.`,
      },
      { status: 400, headers: corsHeaders },
    );
  }

  try {
    const out: Record<string, ReturnType<typeof toWire> | null> = {};
    for (const metricKey of [...new Set(metrics)]) {
      const rows = await listVitals(
        ctx.userId,
        { ownerId: ctx.userId, dependentId: null },
        { metricKey, limit: 1 },
      );
      out[metricKey] = rows[0] ? toWire(rows[0]) : null;
    }
    return Response.json(out, { headers: corsHeaders });
  } catch (error) {
    // Never reflect internal error details to API clients (respond.ts policy).
    console.error('v1 vitals latest GET error:', error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}
