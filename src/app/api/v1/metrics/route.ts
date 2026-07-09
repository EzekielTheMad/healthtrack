/**
 * GET /api/v1/metrics — the metric registry as JSON (machine-readable field
 * schema for bridge authors and LLMs).
 *
 * Deliberately PUBLIC (no auth): it exposes API shape only, never user data.
 * Generated from METRICS at request time so it can never drift from the
 * registry.
 */
import { METRICS } from '@/lib/metrics/registry';

export const dynamic = 'force-static';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function GET() {
  return Response.json(
    METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      category: m.category,
      unit: m.unit,
      value_type: m.valueType,
      ...(m.ordinalLabels ? { ordinal_labels: m.ordinalLabels } : {}),
      aggregate: m.aggregate,
      ...(m.min !== undefined ? { min: m.min } : {}),
      ...(m.max !== undefined ? { max: m.max } : {}),
      ...(m.intraday ? { intraday: true } : {}),
    })),
    { headers: corsHeaders },
  );
}
