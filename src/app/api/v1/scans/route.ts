import { NextRequest } from 'next/server';
import { scanInputSchema } from '@/lib/fidelity/contracts';
import { scanReportGrantRequired } from '@/lib/fidelity/web-write-grants';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { errorResponse } from '@/lib/api/respond';
import { createBodyScan, listBodyScans } from '@/lib/fidelity/scans';
import {
  scanJson,
  scanListOptions,
  rejectPatSubject,
  scanCorsHeaders,
} from '@/lib/fidelity/scan-http';
export const OPTIONS = async () => new Response(null, { headers: scanCorsHeaders });
export async function GET(request: NextRequest) {
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, 'read:vitals')) return forbidden('read:vitals');
  try {
    rejectPatSubject(request.nextUrl.searchParams);
    const options = scanListOptions(request.nextUrl.searchParams);
    const scans = await listBodyScans(
      ctx.userId,
      { ownerId: ctx.userId, dependentId: null },
      options
    );
    return Response.json(
      {
        format: 'typed',
        scans,
        coverage: {
          limit: options.limit,
          returned: scans.length,
          history_may_be_truncated: scans.length === options.limit,
          legacy_vitals_included: false,
          order: 'measurement_evidence_then_stable_id',
        },
      },
      { headers: scanCorsHeaders }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, 'write:scans')) return forbidden('write:scans');
  try {
    rejectPatSubject(request.nextUrl.searchParams);
    const input = scanInputSchema.parse(await scanJson(request));
    if (scanReportGrantRequired(ctx.userId, input) && !hasScope(ctx, 'write:scan_reports'))
      return forbidden('write:scan_reports');
    const result = await createBodyScan(
      ctx.userId,
      { ownerId: ctx.userId, dependentId: null },
      input
    );
    return Response.json(result, {
      status: result.result === 'created' ? 201 : 200,
      headers: scanCorsHeaders,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
