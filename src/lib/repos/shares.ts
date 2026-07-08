/**
 * health_shares repository — share-row management + the public token path.
 *
 * Meta-authorization (003/014, encoded here — NOT in authorize()):
 *   INSERT  owner only (ownerId is always the actor, never client input).
 *   SELECT  owner; recipient by shared_with_id OR by email match. 003's
 *           SELECT policy keyed on shared_with_id only, which made email
 *           invitations invisible/unacceptable in practice (shared_with_id is
 *           only set ON accept — a bootstrap catch-22). We mirror the 012
 *           delegates pattern the route layer always intended: an
 *           email-matched recipient may see and accept/reject their own
 *           invitation. Data access is untouched — authorize() still requires
 *           shared_with_id (email-matched-but-unlinked grants NO data).
 *   UPDATE  owner (settings) or recipient (accept — sets shared_with_id).
 *   DELETE  owner only. A recipient "revoke" was a silent no-op under RLS
 *           (0 rows matched the owner-only DELETE policy, PostgREST reported
 *           success) — revokeShare preserves exactly that: success without
 *           deletion. Also: health_shares.access_level is stored and returned
 *           but RLS never honored 'read_write' — shares grant READ regardless
 *           (preserved in authorize()).
 *
 * Public token path (/api/share/public): getShareByToken + listSharedData run
 * with NO actor — the token itself is the credential. listSharedData queries
 * drizzle directly (it must not weaken authorize()) and applies the share's
 * exact dependent scope to every section query, mirroring the old
 * service-role implementation query-for-query.
 */
import crypto from 'crypto';
import { and, desc, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  healthShares,
  dependents,
  profiles,
  medications,
  conditions,
  vitals,
  labResults,
  allergies,
  procedures,
  vaccines,
  providers,
  appointments,
  notes,
} from '@/db/schema';
import { NotFoundError } from '@/lib/authz';
import { dependentFilter } from './_scope';

export type HealthShareRow = typeof healthShares.$inferSelect;

/** 409 for an existing share to the same email (route maps explicitly). */
export class DuplicateShareError extends Error {
  readonly status = 409;
  constructor(message = 'You already have an active share with this email') {
    super(message);
    this.name = 'DuplicateShareError';
  }
}

export const SHAREABLE_SECTION_VALUES = [
  'medications',
  'conditions',
  'vitals',
  'labs',
  'allergies',
  'procedures',
  'vaccines',
  'providers',
  'appointments',
  'notes',
] as const;

// Parity with lib/validations shareSchema. Unknown keys (owner_id,
// dependent_id, share_token, accepted…) are stripped — never client-set.
const shareInputSchema = z
  .object({
    sharedWithEmail: z.string().email('Valid email required'),
    accessLevel: z.enum(['read', 'read_write']),
    sharedSections: z
      .array(z.enum(SHAREABLE_SECTION_VALUES))
      .min(1, 'Select at least one section'),
    expiresAt: z
      .string()
      .refine((v) => !isNaN(new Date(v).getTime()), {
        message: 'Invalid expiration date',
      })
      .nullish(),
  })
  .strip();

const shareUpdateSchema = z
  .object({
    accessLevel: z.enum(['read', 'read_write']).optional(),
    sharedSections: z.array(z.enum(SHAREABLE_SECTION_VALUES)).min(1).optional(),
  })
  .strip();

export type ShareInput = z.infer<typeof shareInputSchema>;

function isRecipient(share: HealthShareRow, actorId: string, actorEmail: string | null): boolean {
  if (share.sharedWithId === actorId) return true;
  return (
    !!actorEmail && share.sharedWithEmail.toLowerCase() === actorEmail.toLowerCase()
  );
}

/** Shares the actor sent, newest first. */
export async function listSentShares(actorId: string): Promise<HealthShareRow[]> {
  if (!actorId) throw new NotFoundError();
  return db
    .select()
    .from(healthShares)
    .where(eq(healthShares.ownerId, actorId))
    .orderBy(desc(healthShares.createdAt));
}

/** Shares addressed to the actor (by linked id or email match), newest first. */
export async function listReceivedShares(
  actorId: string,
  actorEmail: string | null,
): Promise<HealthShareRow[]> {
  if (!actorId) throw new NotFoundError();
  const [byId, byEmail] = await Promise.all([
    db.select().from(healthShares).where(eq(healthShares.sharedWithId, actorId)),
    actorEmail
      ? db
          .select()
          .from(healthShares)
          .where(eq(healthShares.sharedWithEmail, actorEmail.toLowerCase()))
      : Promise.resolve([] as HealthShareRow[]),
  ]);
  const seen = new Set<string>();
  const merged: HealthShareRow[] = [];
  for (const row of [...byEmail, ...byId]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }
  merged.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return merged;
}

/** Owner-only create; duplicate email (any state) is a 409. */
export async function createShare(
  actorId: string,
  input: unknown,
): Promise<HealthShareRow> {
  if (!actorId) throw new NotFoundError();
  const values = shareInputSchema.parse(input);
  const email = values.sharedWithEmail.toLowerCase();

  const existing = await db
    .select({ id: healthShares.id })
    .from(healthShares)
    .where(
      and(eq(healthShares.ownerId, actorId), eq(healthShares.sharedWithEmail, email)),
    )
    .limit(1);
  if (existing.length > 0) throw new DuplicateShareError();

  const [row] = await db
    .insert(healthShares)
    .values({
      ownerId: actorId,
      sharedWithEmail: email,
      accessLevel: values.accessLevel,
      sharedSections: values.sharedSections,
      shareToken: crypto.randomUUID(),
      accepted: false,
      expiresAt: values.expiresAt ?? null,
    })
    .returning();
  return row;
}

async function loadShare(id: string): Promise<HealthShareRow> {
  const rows = await db
    .select()
    .from(healthShares)
    .where(eq(healthShares.id, id))
    .limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

/**
 * Recipient accepts an invitation — links shared_with_id (delegates-pattern
 * bootstrap) and flips accepted. Non-recipients (including the owner) get 404.
 */
export async function acceptShare(
  actorId: string,
  actorEmail: string | null,
  id: string,
): Promise<HealthShareRow> {
  const share = await loadShare(id);
  if (!isRecipient(share, actorId, actorEmail)) throw new NotFoundError();
  const [updated] = await db
    .update(healthShares)
    .set({ accepted: true, sharedWithId: actorId })
    .where(eq(healthShares.id, id))
    .returning();
  return updated;
}

/**
 * Revoke: the owner's delete. A recipient "revoke" returns without deleting —
 * byte-parity with RLS, where the owner-only DELETE policy matched 0 rows and
 * PostgREST still reported success.
 */
export async function revokeShare(
  actorId: string,
  actorEmail: string | null,
  id: string,
): Promise<void> {
  const share = await loadShare(id);
  const owner = share.ownerId === actorId;
  if (!owner && !isRecipient(share, actorId, actorEmail)) throw new NotFoundError();
  if (owner) {
    await db.delete(healthShares).where(eq(healthShares.id, id));
  }
}

/** Owner-only settings update (access_level / shared_sections). */
export async function updateShare(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<HealthShareRow> {
  const share = await loadShare(id);
  if (share.ownerId !== actorId) throw new NotFoundError();
  const values = shareUpdateSchema.parse(updates);
  const set: Partial<typeof healthShares.$inferInsert> = {};
  if (values.accessLevel) set.accessLevel = values.accessLevel;
  if (values.sharedSections && values.sharedSections.length > 0) {
    set.sharedSections = values.sharedSections;
  }
  if (Object.keys(set).length === 0) {
    // route surfaces this as a 400 before calling — defensive
    return share;
  }
  const [updated] = await db
    .update(healthShares)
    .set(set)
    .where(eq(healthShares.id, id))
    .returning();
  return updated;
}

/** Owner-only hard delete (DELETE /api/share?id=). */
export async function deleteShare(actorId: string, id: string): Promise<void> {
  const share = await loadShare(id);
  if (share.ownerId !== actorId) throw new NotFoundError();
  await db.delete(healthShares).where(eq(healthShares.id, id));
}

// ---------------------------------------------------------------------------
// Public token path (unauthenticated — the token is the credential)
// ---------------------------------------------------------------------------

/** Share row by its public token, or null. Trusted path — no actor. */
export async function getShareByToken(token: string): Promise<HealthShareRow | null> {
  const rows = await db
    .select()
    .from(healthShares)
    .where(eq(healthShares.shareToken, token))
    .limit(1);
  return rows[0] ?? null;
}

/** Display name: dependent's name for dependent-scoped shares, else the
 *  owner's profile display name, else a truncated owner id. */
export async function getShareDisplayName(share: HealthShareRow): Promise<string> {
  if (share.dependentId) {
    const rows = await db
      .select({ name: dependents.name })
      .from(dependents)
      .where(eq(dependents.id, share.dependentId))
      .limit(1);
    return rows[0]?.name ?? 'Shared records';
  }
  const rows = await db
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, share.ownerId))
    .limit(1);
  return rows[0]?.displayName ?? share.ownerId.slice(0, 8) + '...';
}

/**
 * Per-section reads for an accepted, unexpired share. The share's exact
 * dependent scope is applied to every query (NULL for owner shares, the
 * specific dependent for transition shares) — query-for-query parity with the
 * old service-role implementation, including orderings and limits.
 * Rows are drizzle-camelCase; the route snake-cases them.
 */
export async function listSharedData(
  share: HealthShareRow,
): Promise<Record<string, object[]>> {
  const ownerId = share.ownerId;
  const dep = share.dependentId ?? null;
  const sectionData: Record<string, object[]> = {};

  await Promise.all(
    (share.sharedSections ?? []).map(async (section) => {
      switch (section) {
        case 'medications':
          sectionData.medications = await db
            .select()
            .from(medications)
            .where(
              and(
                eq(medications.userId, ownerId),
                eq(medications.active, true),
                dependentFilter(medications.dependentId, dep),
              ),
            )
            .orderBy(asc(medications.name));
          break;
        case 'conditions':
          sectionData.conditions = await db
            .select()
            .from(conditions)
            .where(
              and(
                eq(conditions.userId, ownerId),
                dependentFilter(conditions.dependentId, dep),
              ),
            )
            .orderBy(asc(conditions.name));
          break;
        case 'vitals':
          sectionData.vitals = await db
            .select()
            .from(vitals)
            .where(
              and(eq(vitals.userId, ownerId), dependentFilter(vitals.dependentId, dep)),
            )
            .orderBy(desc(vitals.recordedAt))
            .limit(30);
          break;
        case 'labs':
          sectionData.labs = await db
            .select()
            .from(labResults)
            .where(
              and(
                eq(labResults.userId, ownerId),
                dependentFilter(labResults.dependentId, dep),
              ),
            )
            .orderBy(desc(labResults.createdAt))
            .limit(30);
          break;
        case 'allergies':
          sectionData.allergies = await db
            .select()
            .from(allergies)
            .where(
              and(
                eq(allergies.userId, ownerId),
                dependentFilter(allergies.dependentId, dep),
              ),
            )
            .orderBy(asc(allergies.name));
          break;
        case 'procedures':
          sectionData.procedures = await db
            .select()
            .from(procedures)
            .where(
              and(
                eq(procedures.userId, ownerId),
                dependentFilter(procedures.dependentId, dep),
              ),
            )
            .orderBy(desc(procedures.procedureDate));
          break;
        case 'vaccines':
          sectionData.vaccines = await db
            .select()
            .from(vaccines)
            .where(
              and(
                eq(vaccines.userId, ownerId),
                dependentFilter(vaccines.dependentId, dep),
              ),
            )
            .orderBy(desc(vaccines.vaccineDate));
          break;
        case 'providers':
          sectionData.providers = await db
            .select()
            .from(providers)
            .where(
              and(
                eq(providers.userId, ownerId),
                dependentFilter(providers.dependentId, dep),
              ),
            )
            .orderBy(asc(providers.name));
          break;
        case 'appointments':
          sectionData.appointments = await db
            .select()
            .from(appointments)
            .where(
              and(
                eq(appointments.userId, ownerId),
                dependentFilter(appointments.dependentId, dep),
              ),
            )
            .orderBy(desc(appointments.appointmentDate))
            .limit(20);
          break;
        case 'notes':
          sectionData.notes = await db
            .select()
            .from(notes)
            .where(
              and(eq(notes.userId, ownerId), dependentFilter(notes.dependentId, dep)),
            )
            .orderBy(desc(notes.recordedAt))
            .limit(20);
          break;
        default:
          break;
      }
    }),
  );

  return sectionData;
}
