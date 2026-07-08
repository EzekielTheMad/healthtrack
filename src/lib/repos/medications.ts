/**
 * medications repository.
 *
 * Authorization (003/012/014, encoded in src/lib/authz):
 *   owner full; shares READ-ONLY with section membership + exact dependent_id
 *   match; delegates read (read_only+), insert/update (read_write+), delete
 *   (admin). Unfiltered listings ('all') are owner/delegate only.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { medications } from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type MedicationRow = typeof medications.$inferSelect;

// Unknown keys (id, user_id, dependent_id, timestamps…) are stripped —
// row scope is never client-controlled.
const medicationInputSchema = z
  .object({
    name: z.string().trim().min(1),
    dosage: z.string().nullish(),
    frequency: z.string().nullish(),
    category: z.string().nullish(),
    prescriberId: z.string().nullish(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
    active: z.boolean().optional(),
    notes: z.string().nullish(),
    rxcui: z.string().nullish(),
  })
  .strip();

const medicationUpdateSchema = medicationInputSchema.partial();

export type MedicationInput = z.infer<typeof medicationInputSchema>;

export interface ListMedicationsOptions {
  /** Filter on the active flag (undefined = no filter, hook parity). */
  active?: boolean;
  /** 'created_at' desc (hook default) or 'name' asc (v1 API). */
  orderBy?: 'created_at' | 'name';
}

export async function listMedications(
  actorId: string,
  scope: ListScope,
  opts: ListMedicationsOptions = {},
): Promise<MedicationRow[]> {
  await requireListAuthz(actorId, scope, 'medications', 'read');
  return db
    .select()
    .from(medications)
    .where(
      and(
        eq(medications.userId, scope.ownerId),
        dependentFilter(medications.dependentId, scope.dependentId),
        opts.active === undefined ? undefined : eq(medications.active, opts.active),
      ),
    )
    .orderBy(
      opts.orderBy === 'name' ? asc(medications.name) : desc(medications.createdAt),
    );
}

export async function createMedication(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<MedicationRow> {
  await requireAuthz(actorId, scope, 'medications', 'write');
  const values = medicationInputSchema.parse(input);
  const [row] = await db
    .insert(medications)
    .values({ ...values, userId: scope.ownerId, dependentId: scope.dependentId })
    .returning();
  return row;
}

/** Row scope comes from the row itself (RLS parity for by-id operations). */
async function loadRow(id: string): Promise<MedicationRow> {
  const rows = await db.select().from(medications).where(eq(medications.id, id)).limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function updateMedication(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<MedicationRow> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'medications',
    'write',
  );
  const values = medicationUpdateSchema.parse(updates);
  const [updated] = await db
    .update(medications)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(medications.id, id))
    .returning();
  return updated;
}

export async function deleteMedication(actorId: string, id: string): Promise<void> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'medications',
    'delete',
  );
  await db.delete(medications).where(eq(medications.id, id));
}
