/**
 * /api/integrations/health-connect/{id} — owner-only edit and delete.
 *
 * PATCH moves the integration between inventory/active/paused and records the
 * user's EXACT source-package approvals. Enabling a type without naming a
 * package is refused (no wildcard approval).
 *
 * A patch that newly authorises canonical nutrition writes also REBUILDS the
 * retained records it just made eligible, and reports what that produced.
 *
 * DELETE never touches canonical data. `?delete_raw=false` keeps the raw
 * history (rows are orphaned via ON DELETE SET NULL); the default deletes it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { bodyToCamel } from '@/lib/api/snake';
import {
  HealthConnectConfigError,
  deleteIntegration,
  type HealthConnectPatch,
} from '@/lib/repos/health-connect';
import {
  updateIntegrationSettings,
  type RebuildNutritionReport,
} from '@/lib/integrations/health-connect/rebuild-nutrition';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    // Shallow conversion: allowed_sources is a free-form map keyed by record
    // type, whose keys must survive verbatim (same reasoning as vitals
    // metadata in src/lib/api/snake.ts).
    const patch = bodyToCamel(await request.json()) as HealthConnectPatch;
    // Approving a package, switching strategy or enabling nutrition are
    // RETROACTIVE decisions: the records they cover are already retained, so
    // the affected days are rebuilt here rather than waiting for the phone's
    // next delivery.
    const { integration, rebuild } = await updateIntegrationSettings(user.id, id, patch);
    return NextResponse.json({ integration, rebuild: rebuild ? toRebuildJson(rebuild) : null });
  } catch (error) {
    if (error instanceof HealthConnectConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const deleteRaw = request.nextUrl.searchParams.get('delete_raw') !== 'false';
    const removed = await deleteIntegration(user.id, id, deleteRaw);
    return NextResponse.json({
      success: true,
      raw_deleted: deleteRaw,
      raw_records_deleted: removed.rawRecordsDeleted,
      ingest_runs_deleted: removed.ingestRunsDeleted,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** snake_case rebuild report for the Settings screen. */
function toRebuildJson(report: RebuildNutritionReport) {
  return {
    dates_rebuilt: report.datesRebuilt,
    rows_upserted: report.rowsUpserted,
    rows_deleted: report.rowsDeleted,
    records_considered: report.recordsConsidered,
    records_skipped: report.recordsSkipped,
    errors: report.errors,
  };
}
