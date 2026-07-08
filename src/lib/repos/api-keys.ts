/**
 * api_keys repository — personal-access-token MANAGEMENT (the PAT validation
 * layer itself lives in src/lib/api-auth.ts).
 *
 * Meta-authorization (013): strictly owner-only CRUD, keyed on user_id.
 * The old management route used the service-role client purely to bypass the
 * table's RLS from a trusted context and then re-checked ownership by hand —
 * here ownership is enforced directly. token_hash is never returned.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';

export type ApiKeyRow = typeof apiKeys.$inferSelect;

/** Public view of a key — everything except token_hash + user_id. */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** 409 for revoking an already-revoked key (route maps explicitly). */
export class AlreadyRevokedError extends Error {
  readonly status = 409;
  constructor(message = 'API key is already revoked') {
    super(message);
    this.name = 'AlreadyRevokedError';
  }
}

function toView(row: ApiKeyRow): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

/** The actor's own keys, newest first, without token hashes. */
export async function listApiKeys(actorId: string): Promise<ApiKeyView[]> {
  if (!actorId) throw new NotFoundError();
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, actorId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(toView);
}

/** Store a freshly generated key (hash computed by the caller). */
export async function createApiKey(
  actorId: string,
  input: {
    name: string;
    prefix: string;
    tokenHash: string;
    scopes: string[];
    expiresAt?: string | null;
  },
): Promise<ApiKeyView> {
  if (!actorId) throw new NotFoundError();
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: actorId,
      name: input.name,
      prefix: input.prefix,
      tokenHash: input.tokenHash,
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  return toView(row);
}

/** Owner-only soft revoke; 409 if already revoked. */
export async function revokeApiKey(actorId: string, id: string): Promise<void> {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== actorId) throw new NotFoundError();
  if (row.revokedAt) throw new AlreadyRevokedError();
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(apiKeys.id, id));
}
