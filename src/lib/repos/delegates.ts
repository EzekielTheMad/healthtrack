/**
 * delegates repository — invitation-row management.
 *
 * Meta-authorization (012, encoded here — NOT in authorize()):
 *   Owner: full CRUD on their own delegate rows.
 *   Delegate: may SELECT and UPDATE (accept/reject) rows matched by
 *     delegate_user_id OR by email match to their account email
 *     (delegates_delegate_select / delegates_delegate_update). On accept,
 *     delegate_user_id is linked. Email-matched-but-unlinked rows grant NO
 *     data access — authorize() matches by delegate_user_id only.
 *   DELETE: owner only.
 *
 * The (owner_id, delegate_email) pair is unique while status != 'rejected'
 * (partial index, preserved in the schema); the create path additionally
 * mirrors the route's explicit duplicate check (409 on ANY existing row for
 * the email, matching the pre-drizzle route).
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { delegates } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';

export type DelegateRow = typeof delegates.$inferSelect;

export const DELEGATE_PERMISSION_LEVELS = ['read_only', 'read_write', 'admin'] as const;
export type DelegatePermissionLevel = (typeof DELEGATE_PERMISSION_LEVELS)[number];

/** 409 for an existing invitation to the same email (route maps explicitly). */
export class DuplicateDelegateError extends Error {
  readonly status = 409;
  constructor(message = 'You already have a delegate invitation for this email') {
    super(message);
    this.name = 'DuplicateDelegateError';
  }
}

const delegateInviteSchema = z
  .object({
    delegateEmail: z.string().email('Valid email required'),
    permissionLevel: z.enum(DELEGATE_PERMISSION_LEVELS),
    expiresAt: z
      .string()
      .refine((v) => !isNaN(new Date(v).getTime()), {
        message: 'Invalid expiration date',
      })
      .nullish(),
  })
  .strip();

export type DelegateInviteInput = z.infer<typeof delegateInviteSchema>;

function isRecipient(row: DelegateRow, actorId: string, actorEmail: string | null): boolean {
  if (row.delegateUserId === actorId) return true;
  return (
    !!actorEmail && row.delegateEmail.toLowerCase() === actorEmail.toLowerCase()
  );
}

/** Invitations the actor sent, newest invited_at first. */
export async function listSentDelegates(actorId: string): Promise<DelegateRow[]> {
  if (!actorId) throw new NotFoundError();
  return db
    .select()
    .from(delegates)
    .where(eq(delegates.ownerId, actorId))
    .orderBy(desc(delegates.invitedAt));
}

/** Invitations addressed to the actor (linked id or email match). */
export async function listReceivedDelegates(
  actorId: string,
  actorEmail: string | null,
): Promise<DelegateRow[]> {
  if (!actorId) throw new NotFoundError();
  const [byId, byEmail] = await Promise.all([
    db.select().from(delegates).where(eq(delegates.delegateUserId, actorId)),
    actorEmail
      ? db
          .select()
          .from(delegates)
          .where(eq(delegates.delegateEmail, actorEmail.toLowerCase()))
      : Promise.resolve([] as DelegateRow[]),
  ]);
  const seen = new Set<string>();
  const merged: DelegateRow[] = [];
  for (const row of [...byEmail, ...byId]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }
  merged.sort(
    (a, b) => new Date(b.invitedAt).getTime() - new Date(a.invitedAt).getTime(),
  );
  return merged;
}

/** Owner-only invite; duplicate email (any state) is a 409. */
export async function createDelegateInvite(
  actorId: string,
  input: unknown,
): Promise<DelegateRow> {
  if (!actorId) throw new NotFoundError();
  const values = delegateInviteSchema.parse(input);
  const email = values.delegateEmail.toLowerCase();

  const existing = await db
    .select({ id: delegates.id })
    .from(delegates)
    .where(and(eq(delegates.ownerId, actorId), eq(delegates.delegateEmail, email)))
    .limit(1);
  if (existing.length > 0) throw new DuplicateDelegateError();

  const [row] = await db
    .insert(delegates)
    .values({
      ownerId: actorId,
      delegateEmail: email,
      permissionLevel: values.permissionLevel,
      status: 'pending',
      expiresAt: values.expiresAt ?? null,
    })
    .returning();
  return row;
}

async function loadDelegate(id: string): Promise<DelegateRow> {
  const rows = await db.select().from(delegates).where(eq(delegates.id, id)).limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

/** Recipient accepts — links delegate_user_id if null (012 bootstrap). */
export async function acceptDelegate(
  actorId: string,
  actorEmail: string | null,
  id: string,
): Promise<DelegateRow> {
  const row = await loadDelegate(id);
  if (!isRecipient(row, actorId, actorEmail)) throw new NotFoundError();
  const [updated] = await db
    .update(delegates)
    .set({
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
      delegateUserId: row.delegateUserId ?? actorId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(delegates.id, id))
    .returning();
  return updated;
}

/** Recipient rejects the invitation. */
export async function rejectDelegate(
  actorId: string,
  actorEmail: string | null,
  id: string,
): Promise<DelegateRow> {
  const row = await loadDelegate(id);
  if (!isRecipient(row, actorId, actorEmail)) throw new NotFoundError();
  const [updated] = await db
    .update(delegates)
    .set({ status: 'rejected', updatedAt: new Date().toISOString() })
    .where(eq(delegates.id, id))
    .returning();
  return updated;
}

/** Owner-only permission-level change. */
export async function updateDelegatePermission(
  actorId: string,
  id: string,
  permissionLevel: string,
): Promise<DelegateRow> {
  const row = await loadDelegate(id);
  if (row.ownerId !== actorId) throw new NotFoundError();
  const level = z.enum(DELEGATE_PERMISSION_LEVELS).parse(permissionLevel);
  const [updated] = await db
    .update(delegates)
    .set({ permissionLevel: level, updatedAt: new Date().toISOString() })
    .where(eq(delegates.id, id))
    .returning();
  return updated;
}

/** Owner-only revoke (hard delete). */
export async function deleteDelegate(actorId: string, id: string): Promise<void> {
  const row = await loadDelegate(id);
  if (row.ownerId !== actorId) throw new NotFoundError();
  await db.delete(delegates).where(eq(delegates.id, id));
}
