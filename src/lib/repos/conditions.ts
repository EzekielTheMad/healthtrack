/**
 * conditions repository.
 *
 * Authorization (003/012/014, encoded in src/lib/authz): owner full; shares
 * READ-ONLY with section + exact dependent match; delegates read (read_only+),
 * insert/update (read_write+), delete (admin).
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { conditions } from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type ConditionRow = typeof conditions.$inferSelect;

// CHECK-constraint parity with 001. Unknown keys are stripped — row scope is
// never client-controlled.
const conditionInputSchema = z
  .object({
    name: z.string().trim().min(1),
    status: z.enum(['active', 'resolved', 'managed', 'monitoring']).optional(),
    diagnosedDate: z.string().nullish(),
    providerId: z.string().nullish(),
    notes: z.string().nullish(),
    icd10Code: z.string().nullish(),
  })
  .strip();

const conditionUpdateSchema = conditionInputSchema.partial();

export type ConditionInput = z.infer<typeof conditionInputSchema>;

export interface ListConditionsOptions {
  /** 'created_at' desc (hook default) or 'diagnosed_date' desc (v1 API). */
  orderBy?: 'created_at' | 'diagnosed_date';
}

export async function listConditions(
  actorId: string,
  scope: ListScope,
  opts: ListConditionsOptions = {},
): Promise<ConditionRow[]> {
  await requireListAuthz(actorId, scope, 'conditions', 'read');
  return db
    .select()
    .from(conditions)
    .where(
      and(
        eq(conditions.userId, scope.ownerId),
        dependentFilter(conditions.dependentId, scope.dependentId),
      ),
    )
    .orderBy(
      opts.orderBy === 'diagnosed_date'
        ? desc(conditions.diagnosedDate)
        : desc(conditions.createdAt),
      asc(conditions.name),
    );
}

export async function createCondition(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<ConditionRow> {
  await requireAuthz(actorId, scope, 'conditions', 'write');
  const values = conditionInputSchema.parse(input);
  const [row] = await db
    .insert(conditions)
    .values({ ...values, userId: scope.ownerId, dependentId: scope.dependentId })
    .returning();
  return row;
}

/** Row scope comes from the row itself (RLS parity for by-id operations). */
async function loadRow(id: string): Promise<ConditionRow> {
  const rows = await db.select().from(conditions).where(eq(conditions.id, id)).limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function updateCondition(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<ConditionRow> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'conditions',
    'write',
  );
  const values = conditionUpdateSchema.parse(updates);
  const [updated] = await db
    .update(conditions)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(conditions.id, id))
    .returning();
  return updated;
}

export async function deleteCondition(actorId: string, id: string): Promise<void> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'conditions',
    'delete',
  );
  await db.delete(conditions).where(eq(conditions.id, id));
}
