import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { errorResponse } from '@/lib/api/respond';
import { listBodyScans, selectCoherentScan } from '@/lib/fidelity/scans';
import { scanListOptions, rejectPatSubject, scanCorsHeaders } from '@/lib/fidelity/scan-http';
import { listVitalSourcePreferences } from '@/lib/repos/vitals';
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
      { source: options.source, limit: 1000 }
    );
    const preferences = Object.fromEntries(
      (await listVitalSourcePreferences(ctx.userId)).map((row) => [
        row.metricKey,
        row.preferredSource,
      ])
    );
    return Response.json(
      {
        format: 'typed',
        ...selectCoherentScan(scans, preferences, options.source),
        coverage: {
          available_scans: scans.length,
          max_history: 1000,
          partial_dates_excluded_from_latest: true,
        },
      },
      { headers: scanCorsHeaders }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
