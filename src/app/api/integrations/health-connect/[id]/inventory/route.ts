/**
 * GET /api/integrations/health-connect/{id}/inventory
 *
 * The observed record types × source packages, with counts, time ranges and
 * which optional fields the source actually populates. This is what the user
 * reads BEFORE approving exact packages for canonical writes (PRD §6.5).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { getInventory } from '@/lib/repos/health-connect';
import { RECORD_TYPES } from '@/lib/integrations/health-connect/schema';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const inventory = await getInventory(user.id, id);
    return NextResponse.json({
      inventory,
      // The declared semantic for every type, so the UI can explain why a
      // type is raw-only instead of leaving it unexplained.
      record_types: RECORD_TYPES,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
