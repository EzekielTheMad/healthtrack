/**
 * /api/integrations/health-connect/{id} — owner-only edit and delete.
 *
 * PATCH moves the integration between inventory/active/paused and records the
 * user's EXACT source-package approvals. Enabling a type without naming a
 * package is refused (no wildcard approval).
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
  updateIntegration,
  type HealthConnectPatch,
} from '@/lib/repos/health-connect';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    // Shallow conversion: allowed_sources is a free-form map keyed by record
    // type, whose keys must survive verbatim (same reasoning as vitals
    // metadata in src/lib/api/snake.ts).
    const patch = bodyToCamel(await request.json()) as HealthConnectPatch;
    const integration = await updateIntegration(user.id, id, patch);
    return NextResponse.json({ integration });
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
