/**
 * GET /api/health — container healthcheck endpoint.
 *
 * Unauthenticated by design: Docker HEALTHCHECK and orchestrators hit this.
 * Confirms the process is serving requests AND the SQLite database is
 * reachable (trivial `select 1`). Returns 503 when the DB cannot be opened
 * so a wedged container fails its healthcheck instead of lying.
 */
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

// Never pre-render; must hit the live database on every request.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    db.get(sql`select 1`);
    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    console.error('[health] database check failed:', err);
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
