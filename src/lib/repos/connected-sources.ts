/**
 * connected_sources repository (Oura etc.).
 *
 * Authorization (003): strictly owner-only, keyed on user_id — no share or
 * delegate grants. Token columns hold AES-256-GCM ciphertext (src/lib/crypto,
 * keyed via getOrCreateSecret('encryption_key')).
 *
 * Upsert note: 001 never gave connected_sources a (user_id, source_name)
 * unique constraint, so the legacy PostgREST `upsert(..., onConflict:
 * 'user_id,source_name')` is emulated here as select→update-or-insert. The
 * pair is treated as logically unique (one row per user per source).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { connectedSources } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';

export type ConnectedSourceRow = typeof connectedSources.$inferSelect;

export interface ConnectedSourceTokens {
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: string | null;
}

/** The actor's row for a source, or null. */
export async function getConnectedSource(
  actorId: string,
  sourceName: string,
): Promise<ConnectedSourceRow | null> {
  if (!actorId) throw new NotFoundError();
  const rows = await db
    .select()
    .from(connectedSources)
    .where(
      and(
        eq(connectedSources.userId, actorId),
        eq(connectedSources.sourceName, sourceName),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Connect / reconnect a source: replaces tokens, resets status to 'active'
 * and clears last_sync_at — field-parity with the legacy callback upsert.
 */
export async function upsertConnectedSource(
  actorId: string,
  sourceName: string,
  tokens: ConnectedSourceTokens,
): Promise<ConnectedSourceRow> {
  if (!actorId) throw new NotFoundError();
  const existing = await getConnectedSource(actorId, sourceName);
  const fields = {
    accessTokenEncrypted: tokens.accessTokenEncrypted,
    refreshTokenEncrypted: tokens.refreshTokenEncrypted,
    tokenExpiresAt: tokens.tokenExpiresAt,
    status: 'active',
    lastSyncAt: null,
  };
  if (existing) {
    const [row] = await db
      .update(connectedSources)
      .set(fields)
      .where(eq(connectedSources.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(connectedSources)
    .values({ userId: actorId, sourceName, ...fields })
    .returning();
  return row;
}

/** Persist refreshed OAuth tokens on the actor's row. */
export async function updateConnectedSourceTokens(
  actorId: string,
  id: string,
  tokens: ConnectedSourceTokens,
): Promise<void> {
  await db
    .update(connectedSources)
    .set(tokens)
    .where(and(eq(connectedSources.id, id), eq(connectedSources.userId, actorId)));
}

/** Status transitions ('active' | 'expired' | 'disconnected'). Owner-only. */
export async function setConnectedSourceStatus(
  actorId: string,
  sourceName: string,
  status: string,
): Promise<void> {
  if (!actorId) throw new NotFoundError();
  await db
    .update(connectedSources)
    .set({ status })
    .where(
      and(
        eq(connectedSources.userId, actorId),
        eq(connectedSources.sourceName, sourceName),
      ),
    );
}

/** Stamp last_sync_at (called by the sync job). */
export async function touchLastSync(
  actorId: string,
  sourceName: string,
): Promise<void> {
  await db
    .update(connectedSources)
    .set({ lastSyncAt: new Date().toISOString() })
    .where(
      and(
        eq(connectedSources.userId, actorId),
        eq(connectedSources.sourceName, sourceName),
      ),
    );
}
