/**
 * /api/integrations/health-connect — Health Connect integration management
 * (owner-only, session-authenticated).
 *
 * Management lives on the session surface, not /api/v1: it mints and reveals
 * an HMAC secret, so it must be reachable only by a signed-in browser
 * session, exactly like /api/api-keys. The PAT surface exposes only the
 * webhook receiver itself.
 *
 * GET returns the full status snapshot the Settings screen renders
 * (integration, inventory, recent runs, last backfill window). The HMAC
 * secret is never part of any response except the one-time create reveal.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/session';
import { rowsToSnake } from '@/lib/api/snake';
import {
  IntegrationExistsError,
  createIntegration,
  getIntegrationStatus,
} from '@/lib/repos/health-connect';
import { errorResponse } from '@/lib/api/respond';

export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  try {
    const status = await getIntegrationStatus(user.id);
    if (!status) return NextResponse.json({ integration: null });
    return NextResponse.json({
      integration: status.integration,
      inventory: status.inventory,
      runs: rowsToSnake(status.runs),
      last_backfill_window: status.lastBackfillWindow,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: { name?: string } = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed as { name?: string };
  } catch {
    // An empty body is fine — the name defaults.
  }

  try {
    const { integration, secret } = await createIntegration(user.id, body);
    // The plaintext secret is shown exactly once (PRD §6.1).
    return NextResponse.json({ integration, secret }, { status: 201 });
  } catch (error) {
    if (error instanceof IntegrationExistsError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return errorResponse(error);
  }
}
