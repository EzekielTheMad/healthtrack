import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import {
  createBodyScan,
  listBodyScans,
  getBodyScan,
  compareScans,
  selectCoherentScan,
} from '@/lib/fidelity/scans';
import { scanInputSchema } from '@/lib/fidelity/contracts';
import { scanJson, scanListOptions } from '@/lib/fidelity/scan-http';
import { listVitalSourcePreferences } from '@/lib/repos/vitals';

const inputSchema = z
  .object({
    scan: scanInputSchema,
    owner_id: z.string().min(1).max(200).optional(),
    dependent_id: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const params = request.nextUrl.searchParams;
    const scope = {
      ownerId: params.get('owner_id') || user.id,
      dependentId: params.get('dependent_id') || null,
    };
    const options = scanListOptions(params);
    const scans = await listBodyScans(user.id, scope, options);
    const historyMayBeTruncated = scans.length === options.limit;
    const focusId = params.get('scan_id');
    let focused = null;
    if (focusId) {
      z.string().min(1).max(200).parse(focusId);
      focused = await getBodyScan(user.id, scope, focusId);
      if (!scans.some((row) => row.id === focused!.id)) scans.push(focused);
      scans.sort(compareScans);
    }
    const preferences =
      scope.ownerId === user.id && !scope.dependentId
        ? Object.fromEntries(
            (await listVitalSourcePreferences(user.id)).map((row) => [
              row.metricKey,
              row.preferredSource,
            ])
          )
        : {};
    return NextResponse.json({
      scans,
      preferences,
      latest: selectCoherentScan(scans, preferences, options.source),
      focused_scan_id: focused?.id ?? null,
      coverage: {
        limit: options.limit,
        returned: scans.length,
        history_may_be_truncated: historyMayBeTruncated,
        order: 'measurement_evidence_then_stable_id',
        unknown_dates_are_not_latest: true,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const input = inputSchema.parse(await scanJson(request));
    const result = await createBodyScan(
      user.id,
      { ownerId: input.owner_id ?? user.id, dependentId: input.dependent_id ?? null },
      input.scan
    );
    return NextResponse.json(result, { status: result.result === 'created' ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
