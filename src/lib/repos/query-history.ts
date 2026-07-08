/**
 * query_history repository.
 *
 * Authorization (003): strictly owner-only, keyed on user_id. No share or
 * delegate grants exist for this table — the AI query log is private to the
 * account that asked.
 */
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { queryHistory } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';

export type QueryHistoryRow = typeof queryHistory.$inferSelect;

const entrySchema = z
  .object({
    queryText: z.string().min(1),
    responseText: z.string().min(1),
    dependentId: z.string().nullish(),
  })
  .strip();

/** The actor's own history, newest first. */
export async function listQueryHistory(actorId: string): Promise<QueryHistoryRow[]> {
  if (!actorId) throw new NotFoundError();
  return db
    .select()
    .from(queryHistory)
    .where(eq(queryHistory.userId, actorId))
    .orderBy(desc(queryHistory.createdAt));
}

export async function createQueryHistoryEntry(
  actorId: string,
  input: { queryText: string; responseText: string; dependentId?: string | null },
): Promise<QueryHistoryRow> {
  if (!actorId) throw new NotFoundError();
  const values = entrySchema.parse(input);
  const [row] = await db
    .insert(queryHistory)
    .values({
      userId: actorId,
      queryText: values.queryText,
      responseText: values.responseText,
      dependentId: values.dependentId ?? null,
    })
    .returning();
  return row;
}
