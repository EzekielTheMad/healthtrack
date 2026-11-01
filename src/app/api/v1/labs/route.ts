import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listLabResultsV1 } from '@/lib/repos/labs';
import { clinicalProjectionCoverage, listClinicalFacts } from '@/lib/fidelity/clinical';
import { clampLimit } from '@/lib/api/v1-fitness';

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
    if (searchParams.get('format') === 'typed') {
      if (searchParams.has('days'))
        return Response.json(
          {
            error:
              'The days filter is not supported for typed labs because collection dates may be partial or unknown. Omit days and inspect each fact.collection_date precision/value; use the legacy numeric endpoint when its days window is appropriate.',
          },
          { status: 400, headers: corsHeaders }
        );
      const limit = clampLimit(searchParams.get('limit'), 200, 1000);
      const records = await listClinicalFacts(
        ctx.userId,
        { ownerId: ctx.userId, dependentId: null },
        { kind: 'lab', limit, test }
      );
      return Response.json(
        {
          format: 'typed',
          records,
          coverage: {
            test_filter: test,
            limit,
            may_be_limited: records.length >= limit,
            collection_dates:
              'Includes exact, partial and unknown collection dates. A days filter is unsupported; inspect collection_date precision/value explicitly.',
            legacy_receipt: 'unknown',
            warning:
              'Qualified outcomes are not exact numeric trend points. Conflicted legacy originals and typed overlays are both explicit.',
          },
        },
        { headers: corsHeaders }
      );
    }
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
      {
        headers: {
          ...corsHeaders,
          'Access-Control-Expose-Headers': 'X-HealthTrack-Clinical-Coverage, Link',
          'X-HealthTrack-Clinical-Coverage': JSON.stringify(
            await clinicalProjectionCoverage(
              ctx.userId,
              { ownerId: ctx.userId, dependentId: null },
              'lab'
            )
          ),
          Link: '</api/v1/labs?format=typed>; rel="alternate"',
        },
      }
    );
  } catch (error) {
    console.error('[v1] request failed:', error instanceof Error ? error.message : error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}
