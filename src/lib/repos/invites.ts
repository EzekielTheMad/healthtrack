/**
 * invites repository — single-use registration invites.
 *
 * Trust model: creating/listing/revoking invites is ADMIN-only (enforced in
 * the API routes, not here — this repo is also called from the auth layer,
 * which has no acting user yet). Consumption is atomic: one UPDATE guarded on
 * `used_at IS NULL AND expires_at > now`, so a token can never be redeemed
 * twice even under concurrent signup attempts.
 *
 * An invite is consumed at the moment a signup ATTEMPT passes the gate (see
 * src/lib/auth/index.ts). If that signup then fails (e.g. duplicate email),
 * the invite is burned — deliberate: burn-on-attempt closes any replay
 * window, and an admin can mint a fresh link in seconds.
 */
import { randomBytes } from 'crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { invites } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';

export type InviteRow = typeof invites.$inferSelect;

export const DEFAULT_INVITE_DAYS = 7;
export const MAX_INVITE_DAYS = 30;

/** Create an invite; returns the row (token included — shown once in the UI). */
export async function createInvite(
  actorId: string,
  input: { note?: string | null; expiresInDays?: number } = {},
): Promise<InviteRow> {
  if (!actorId) throw new NotFoundError();
  const days = Math.min(
    Math.max(Math.floor(input.expiresInDays ?? DEFAULT_INVITE_DAYS), 1),
    MAX_INVITE_DAYS,
  );
  const [row] = await db
    .insert(invites)
    .values({
      token: randomBytes(24).toString('base64url'),
      createdBy: actorId,
      note: input.note?.slice(0, 200) ?? null,
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    })
    .returning();
  return row;
}

/** All invites, newest first (admin list view). */
export async function listInvites(): Promise<InviteRow[]> {
  return db.select().from(invites).orderBy(desc(invites.createdAt));
}

/** Delete an invite (revoke if unused; cleanup if used). */
export async function deleteInvite(id: string): Promise<void> {
  await db.delete(invites).where(eq(invites.id, id));
}

/** True if the token exists, is unused, and hasn't expired. Read-only. */
export async function isInviteValid(token: string): Promise<boolean> {
  if (!token) return false;
  const now = new Date().toISOString();
  const [row] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      sql`${invites.token} = ${token} and ${invites.usedAt} is null and ${invites.expiresAt} > ${now}`,
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Atomically consume a valid token (single guarded UPDATE — safe under
 * concurrency). Returns true when this call won the redemption.
 */
export async function consumeInvite(token: string, email?: string): Promise<boolean> {
  if (!token) return false;
  const now = new Date().toISOString();
  const rows = await db
    .update(invites)
    .set({ usedAt: now, usedEmail: email?.slice(0, 200) ?? null })
    .where(
      sql`${invites.token} = ${token} and ${invites.usedAt} is null and ${invites.expiresAt} > ${now}`,
    )
    .returning({ id: invites.id });
  return rows.length > 0;
}
