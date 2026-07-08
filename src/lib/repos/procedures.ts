/**
 * procedures repository.
 *
 * Authorization (005/012/014, encoded in src/lib/authz): owner full; shares
 * READ-ONLY with section + exact dependent match; delegates read (read_only+),
 * insert/update (read_write+), delete (admin).
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { procedures } from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type ProcedureRow = typeof procedures.$inferSelect;

// Unknown keys are stripped — row scope is never client-controlled.
const procedureInputSchema = z
  .object({
    name: z.string().trim().min(1),
    cptCode: z.string().nullish(),
    procedureDate: z.string().min(1),
    providerId: z.string().nullish(),
    notes: z.string().nullish(),
  })
  .strip();

const procedureUpdateSchema = procedureInputSchema.partial();

export type ProcedureInput = z.infer<typeof procedureInputSchema>;

export async function listProcedures(
  actorId: string,
  scope: ListScope,
): Promise<ProcedureRow[]> {
  await requireListAuthz(actorId, scope, 'procedures', 'read');
  return db
    .select()
    .from(procedures)
    .where(
      and(
        eq(procedures.userId, scope.ownerId),
        dependentFilter(procedures.dependentId, scope.dependentId),
      ),
    )
    .orderBy(desc(procedures.procedureDate));
}

export async function createProcedure(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<ProcedureRow> {
  await requireAuthz(actorId, scope, 'procedures', 'write');
  const values = procedureInputSchema.parse(input);
  const [row] = await db
    .insert(procedures)
    .values({ ...values, userId: scope.ownerId, dependentId: scope.dependentId })
    .returning();
  return row;
}

/** Row scope comes from the row itself (RLS parity for by-id operations). */
async function loadRow(id: string): Promise<ProcedureRow> {
  const rows = await db.select().from(procedures).where(eq(procedures.id, id)).limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function updateProcedure(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<ProcedureRow> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'procedures',
    'write',
  );
  const values = procedureUpdateSchema.parse(updates);
  const [updated] = await db
    .update(procedures)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(procedures.id, id))
    .returning();
  return updated;
}

export async function deleteProcedure(actorId: string, id: string): Promise<void> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'procedures',
    'delete',
  );
  await db.delete(procedures).where(eq(procedures.id, id));
}
