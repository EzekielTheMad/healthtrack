/**
 * query_history repository.
 *
 * Authorization (003): strictly owner-only, keyed on user_id. No share or
 * delegate grants exist for this table — the AI query log is private to the
 * account that asked.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { queryHistory } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';
import { OWNER_AI_CONTEXT_VERSION } from '@/lib/claude/owner-context';

export type QueryHistoryRow = typeof queryHistory.$inferSelect;

const entrySchema = z
  .object({
    queryText: z.string().min(1),
    responseText: z.string().min(1),
    // This AI surface is owner-only; reject any requested dependent scope.
    dependentId: z.null().optional(),
  })
  .strip();

/** The actor's current owner-only context history, newest first. */
export async function listQueryHistory(actorId: string): Promise<QueryHistoryRow[]> {
  if (!actorId) throw new NotFoundError();
  return db
    .select()
    .from(queryHistory)
    .where(
      and(
        eq(queryHistory.userId, actorId),
        isNull(queryHistory.dependentId),
        eq(queryHistory.contextVersion, OWNER_AI_CONTEXT_VERSION)
      )
    )
    .orderBy(desc(queryHistory.createdAt));
}

export async function createQueryHistoryEntry(
  actorId: string,
  input: { queryText: string; responseText: string; dependentId?: string | null }
): Promise<QueryHistoryRow> {
  if (!actorId) throw new NotFoundError();
  const values = entrySchema.parse(input);
  const [row] = await db
    .insert(queryHistory)
    .values({
      userId: actorId,
      queryText: values.queryText,
      responseText: values.responseText,
      dependentId: null,
      // Trust only the server policy version, never a field supplied by input.
      contextVersion: OWNER_AI_CONTEXT_VERSION,
    })
    .returning();
  return row;
}
