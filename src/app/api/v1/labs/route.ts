import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listLabResultsV1 } from '@/lib/repos/labs';

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
  if (!hasScope(ctx, 'read:labs')) return forbidden('read:labs');

  const { searchParams } = request.nextUrl;
  const test = searchParams.get('test');
  const days = parseInt(searchParams.get('days') ?? '0', 10) || null;

  try {
    // PAT scope: the key owner's own data, dependent_id NULL — parity with
    // the legacy PostgREST implementation (id desc, ilike test filter, days window).
    const rows = await listLabResultsV1(ctx.userId, { test, days });

    // Response shape byte-identical to the legacy PostgREST select + flatten: same
    // fields, same key order, visit_date last.
    return Response.json(
      rows.map((r) => ({
        id: r.id,
        test_name: r.testName,
        panel_name: r.panelName,
        value: r.value,
        unit: r.unit,
        reference_range_low: r.referenceRangeLow,
        reference_range_high: r.referenceRangeHigh,
        flag: r.flag,
        loinc_code: r.loincCode,
        visit_date: r.visitDate,
      })),
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
