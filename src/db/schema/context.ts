import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { queryHistory } from './integrations';

export const queryContexts = sqliteTable('query_contexts', {
  queryId: text('query_id')
    .primaryKey()
    .references(() => queryHistory.id, { onDelete: 'cascade' }),
  metadataJson: text('metadata_json').notNull(),
});
