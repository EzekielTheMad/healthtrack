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
import { queryHistory, queryContexts } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';
import type { QueryContextMetadata } from '@/lib/health-context-types';

export type QueryHistoryRow = typeof queryHistory.$inferSelect & {
  contextMetadata?: QueryContextMetadata;
};

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
  const rows = await db
    .select({ entry: queryHistory, metadata: queryContexts.metadataJson })
    .from(queryHistory)
    .leftJoin(queryContexts, eq(queryContexts.queryId, queryHistory.id))
    .where(eq(queryHistory.userId, actorId))
    .orderBy(desc(queryHistory.createdAt));
  return rows.map(({ entry, metadata }) => ({
    ...entry,
    ...(metadata ? { contextMetadata: JSON.parse(metadata) as QueryContextMetadata } : {}),
  }));
}

export async function createQueryHistoryEntry(
  actorId: string,
  input: {
    queryText: string;
    responseText: string;
    dependentId?: string | null;
    contextMetadata?: QueryContextMetadata;
  }
): Promise<QueryHistoryRow> {
  if (!actorId) throw new NotFoundError();
  const values = entrySchema.parse(input);
  const row = db.transaction((tx) => {
    const [entry] = tx
      .insert(queryHistory)
      .values({
        userId: actorId,
        queryText: values.queryText,
        responseText: values.responseText,
        dependentId: values.dependentId ?? null,
      })
      .returning()
      .all();
    if (input.contextMetadata)
      tx.insert(queryContexts)
        .values({ queryId: entry.id, metadataJson: JSON.stringify(input.contextMetadata) })
        .run();
    return entry;
  });
  return { ...row, ...(input.contextMetadata ? { contextMetadata: input.contextMetadata } : {}) };
}
