/**
 * allergies repository.
 *
 * Authorization (005/012/014, encoded in src/lib/authz): owner full; shares
 * READ-ONLY with section + exact dependent match; delegates read (read_only+),
 * insert/update (read_write+), delete (admin).
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { allergies } from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type AllergyRow = typeof allergies.$inferSelect;

// CHECK-constraint parity with 005. Unknown keys are stripped.
const allergyInputSchema = z
  .object({
    name: z.string().trim().min(1),
    rxcui: z.string().nullish(),
    severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']),
    reaction: z.string().nullish(),
    diagnosedDate: z.string().nullish(),
    notes: z.string().nullish(),
  })
  .strip();

const allergyUpdateSchema = allergyInputSchema.partial();

export type AllergyInput = z.infer<typeof allergyInputSchema>;

export interface ListAllergiesOptions {
  /** 'created_at' desc (hook default) or 'name' asc (v1 API). */
  orderBy?: 'created_at' | 'name';
}

export async function listAllergies(
  actorId: string,
  scope: ListScope,
  opts: ListAllergiesOptions = {},
): Promise<AllergyRow[]> {
  await requireListAuthz(actorId, scope, 'allergies', 'read');
  return db
    .select()
    .from(allergies)
    .where(
      and(
        eq(allergies.userId, scope.ownerId),
        dependentFilter(allergies.dependentId, scope.dependentId),
      ),
    )
    .orderBy(
      opts.orderBy === 'name' ? asc(allergies.name) : desc(allergies.createdAt),
    );
}

export async function createAllergy(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<AllergyRow> {
  await requireAuthz(actorId, scope, 'allergies', 'write');
  const values = allergyInputSchema.parse(input);
  const [row] = await db
    .insert(allergies)
    .values({ ...values, userId: scope.ownerId, dependentId: scope.dependentId })
    .returning();
  return row;
}

/** Row scope comes from the row itself (RLS parity for by-id operations). */
async function loadRow(id: string): Promise<AllergyRow> {
  const rows = await db.select().from(allergies).where(eq(allergies.id, id)).limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function updateAllergy(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<AllergyRow> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'allergies',
    'write',
  );
  const values = allergyUpdateSchema.parse(updates);
  const [updated] = await db
    .update(allergies)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(allergies.id, id))
    .returning();
  return updated;
}

export async function deleteAllergy(actorId: string, id: string): Promise<void> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'allergies',
    'delete',
  );
  await db.delete(allergies).where(eq(allergies.id, id));
}
