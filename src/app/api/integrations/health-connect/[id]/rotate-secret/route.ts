/**
 * POST /api/integrations/health-connect/{id}/rotate-secret
 *
 * Mints a new HMAC secret and returns it exactly once. The previous secret is
 * invalidated IMMEDIATELY — there is no overlap window, so deliveries fail
 * (403) until the phone is reconfigured (PRD §9).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { rotateSecret } from '@/lib/repos/health-connect';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const secret = await rotateSecret(user.id, id);
    return NextResponse.json({ secret });
  } catch (error) {
    return errorResponse(error);
  }
}
