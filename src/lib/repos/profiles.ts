/**
 * profiles repository.
 *
 * Authorization (003/012, encoded in src/lib/authz):
 *   - profiles.id IS the user id (PK = FK to auth user).
 *   - Owner: full access. Delegates: READ-ONLY at every permission level
 *     (012 has profiles_delegate_read only). Shares: never grant 'profile'.
 *   - Dependent "profiles" live in the dependents table, not here.
 *
 * The DB always stores imperial units; profiles.unit_system is the
 * display-layer preference (007).
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { profiles } from '@/db/schema';
import { requireAuthz } from '@/lib/authz';

export type ProfileRow = typeof profiles.$inferSelect;

// CHECK-constraint parity with 001/007: biological_sex in ('male','female'),
// unit_system in ('imperial','metric'). Unknown keys are stripped.
const profileInputSchema = z
  .object({
    displayName: z.string().trim().max(200).nullish(),
    dateOfBirth: z.string().nullish(),
    biologicalSex: z.enum(['male', 'female']).nullish(),
    heightInches: z.number().int().nullish(),
    weightLbs: z.number().nullish(),
    unitSystem: z.enum(['imperial', 'metric']).optional(),
  })
  .strip();

export type ProfileInput = z.infer<typeof profileInputSchema>;

export async function getProfile(
  actorId: string,
  ownerId: string,
): Promise<ProfileRow | null> {
  await requireAuthz(actorId, { ownerId, dependentId: null }, 'profile', 'read');
  const rows = await db.select().from(profiles).where(eq(profiles.id, ownerId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Insert-or-update the profile row (PostgREST callers used upsert on id).
 * Only provided keys are written; updatedAt is set explicitly (no trigger in
 * SQLite).
 */
export async function upsertProfile(
  actorId: string,
  ownerId: string,
  input: unknown,
): Promise<ProfileRow> {
  await requireAuthz(actorId, { ownerId, dependentId: null }, 'profile', 'write');
  const values = profileInputSchema.parse(input);
  const now = new Date().toISOString();
  const [row] = await db
    .insert(profiles)
    .values({ id: ownerId, ...values, updatedAt: now })
    .onConflictDoUpdate({
      target: profiles.id,
      set: { ...values, updatedAt: now },
    })
    .returning();
  return row;
}
