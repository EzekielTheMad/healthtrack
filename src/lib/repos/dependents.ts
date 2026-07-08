/**
 * dependents repository.
 *
 * Authorization (004): strictly owner-only — a single FOR ALL policy keyed on
 * parent_user_id ("Users can manage their own dependents"). Shares and
 * delegates grant NOTHING on dependents rows themselves; the 012/014 grants
 * apply to the data tables, not to dependent management. Denials are 404
 * (RLS parity: a non-owner probe saw an empty result, never a 403).
 *
 * Transition flow (preserved exactly from the pre-drizzle route): transition
 * marks the dependent `transitioned` and creates a dependent-scoped
 * health_share invitation (read-only, all 10 shareable sections, not yet
 * accepted) for the new adult's email. Data rows are NOT re-keyed — they stay
 * under the parent's user_id + dependent_id, and the new account reads them
 * by accepting the share (exact dependent_id matching, 014).
 * `transitioned_to` is never set by this flow.
 */
import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { dependents, healthShares } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';

export type DependentRow = typeof dependents.$inferSelect;

/** 409 for a second transition attempt (route maps this explicitly). */
export class AlreadyTransitionedError extends Error {
  readonly status = 409;
  constructor(message = 'This dependent has already been transitioned') {
    super(message);
    this.name = 'AlreadyTransitionedError';
  }
}

/** Sections granted by a transition share (pre-drizzle route, verbatim). */
export const TRANSITION_SHARE_SECTIONS = [
  'medications',
  'conditions',
  'labs',
  'vitals',
  'allergies',
  'procedures',
  'vaccines',
  'notes',
  'appointments',
  'providers',
] as const;

// Validation parity with lib/validations dependentSchema. Unknown keys —
// including transitioned/transitioned_to/parent_user_id — are stripped, so
// transition state is never client-controlled.
const dependentInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(100, 'Name must be at most 100 characters'),
    dateOfBirth: z
      .string()
      .min(1, 'Date of birth is required')
      .refine(
        (val) => {
          const d = new Date(val);
          return !isNaN(d.getTime()) && d <= new Date();
        },
        { message: 'Date cannot be in the future' },
      ),
    biologicalSex: z.enum(['male', 'female']).nullish(),
    relationship: z.enum(['child', 'spouse', 'parent', 'sibling', 'other']),
    transitionAge: z.number().int().min(13).max(25),
  })
  .strip();

const dependentUpdateSchema = dependentInputSchema.partial();

export type DependentInput = z.infer<typeof dependentInputSchema>;

/** The actor's own dependents, newest first (hook parity). */
export async function listDependents(actorId: string): Promise<DependentRow[]> {
  if (!actorId) throw new NotFoundError();
  return db
    .select()
    .from(dependents)
    .where(eq(dependents.parentUserId, actorId))
    .orderBy(desc(dependents.createdAt));
}

export async function createDependent(
  actorId: string,
  input: unknown,
): Promise<DependentRow> {
  if (!actorId) throw new NotFoundError();
  const values = dependentInputSchema.parse(input);
  const [row] = await db
    .insert(dependents)
    .values({ ...values, parentUserId: actorId })
    .returning();
  return row;
}

/** Owner-only row load — non-owner sees 404, exactly like RLS empty results. */
async function loadOwnedRow(actorId: string, id: string): Promise<DependentRow> {
  const rows = await db
    .select()
    .from(dependents)
    .where(eq(dependents.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.parentUserId !== actorId) throw new NotFoundError();
  return row;
}

export async function updateDependent(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<DependentRow> {
  await loadOwnedRow(actorId, id);
  const values = dependentUpdateSchema.parse(updates);
  const [updated] = await db
    .update(dependents)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(dependents.id, id))
    .returning();
  return updated;
}

export async function deleteDependent(actorId: string, id: string): Promise<void> {
  await loadOwnedRow(actorId, id);
  await db.delete(dependents).where(eq(dependents.id, id));
}

/**
 * Transition a dependent to an independent adult account. Marks the row
 * transitioned and creates the dependent-scoped share invitation atomically
 * (the pre-drizzle route emulated this with a manual rollback).
 * Returns the share token for the response payload.
 */
export async function transitionDependent(
  actorId: string,
  id: string,
  newUserEmail: string,
): Promise<{ shareToken: string }> {
  const row = await loadOwnedRow(actorId, id);
  if (row.transitioned) throw new AlreadyTransitionedError();

  const shareToken = crypto.randomUUID();
  db.transaction((tx) => {
    tx.update(dependents)
      .set({ transitioned: true, updatedAt: new Date().toISOString() })
      .where(eq(dependents.id, id))
      .run();
    tx.insert(healthShares)
      .values({
        ownerId: actorId,
        dependentId: id,
        sharedWithEmail: newUserEmail.toLowerCase(),
        accessLevel: 'read',
        sharedSections: [...TRANSITION_SHARE_SECTIONS],
        shareToken,
        accepted: false,
      })
      .run();
  });
  return { shareToken };
}
