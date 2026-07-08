/**
 * vaccines repository.
 *
 * Authorization (008/012/014, encoded in src/lib/authz): owner full; shares
 * READ-ONLY with section + exact dependent match; delegates read (read_only+),
 * insert/update (read_write+), delete (admin).
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { vaccines } from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type VaccineRow = typeof vaccines.$inferSelect;

// dose_number / series_doses are TEXT columns (008) but some client types
// treat them as numbers — accept both and store the string form.
const stringish = z.preprocess(
  (v) => (typeof v === 'number' ? String(v) : v),
  z.string().nullish(),
);

// Unknown keys are stripped — row scope is never client-controlled.
const vaccineInputSchema = z
  .object({
    name: z.string().trim().min(1),
    cvxCode: z.string().nullish(),
    vaccineDate: z.string().min(1),
    doseNumber: stringish,
    seriesDoses: stringish,
    manufacturer: z.string().nullish(),
    lotNumber: z.string().nullish(),
    providerId: z.string().nullish(),
    nextDoseDate: z.string().nullish(),
    notes: z.string().nullish(),
  })
  .strip();

const vaccineUpdateSchema = vaccineInputSchema.partial();

export type VaccineInput = z.infer<typeof vaccineInputSchema>;

export async function listVaccines(
  actorId: string,
  scope: ListScope,
): Promise<VaccineRow[]> {
  await requireListAuthz(actorId, scope, 'vaccines', 'read');
  return db
    .select()
    .from(vaccines)
    .where(
      and(
        eq(vaccines.userId, scope.ownerId),
        dependentFilter(vaccines.dependentId, scope.dependentId),
      ),
    )
    .orderBy(desc(vaccines.vaccineDate));
}

export async function createVaccine(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<VaccineRow> {
  await requireAuthz(actorId, scope, 'vaccines', 'write');
  const values = vaccineInputSchema.parse(input);
  const [row] = await db
    .insert(vaccines)
    .values({ ...values, userId: scope.ownerId, dependentId: scope.dependentId })
    .returning();
  return row;
}

/** Row scope comes from the row itself (RLS parity for by-id operations). */
async function loadRow(id: string): Promise<VaccineRow> {
  const rows = await db.select().from(vaccines).where(eq(vaccines.id, id)).limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function updateVaccine(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<VaccineRow> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'vaccines',
    'write',
  );
  const values = vaccineUpdateSchema.parse(updates);
  const [updated] = await db
    .update(vaccines)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(vaccines.id, id))
    .returning();
  return updated;
}

export async function deleteVaccine(actorId: string, id: string): Promise<void> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'vaccines',
    'delete',
  );
  await db.delete(vaccines).where(eq(vaccines.id, id));
}
