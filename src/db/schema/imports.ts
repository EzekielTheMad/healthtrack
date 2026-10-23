import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { dependents } from './users';
import { uuidPk, timestampNow } from './_shared';

/** Documents and extracted claims remain separate from accepted clinical facts. */
export const importBatches = sqliteTable(
  'import_batches',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    fileHash: text('file_hash').notNull(),
    kind: text('kind').notNull(),
    fileName: text('file_name').notNull(),
    sourcePath: text('source_path'),
    status: text('status').notNull().default('pending'),
    warnings: text('warnings', { mode: 'json' }).$type<string[]>().notNull().default([]),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    uniqueIndex('idx_import_batch_file').on(
      t.userId,
      sql`coalesce(${t.dependentId}, '')`,
      t.fileHash,
      t.kind
    ),
  ]
);

export const importItems = sqliteTable(
  'import_items',
  {
    id: uuidPk(),
    batchId: text('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    domain: text('domain').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    appliedPayload: text('applied_payload', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status').notNull().default('pending'),
    classification: text('classification').notNull().default('new'),
    recordId: text('record_id'),
    action: text('action'),
    error: text('error'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_import_items_batch').on(t.batchId),
    uniqueIndex('idx_import_items_position').on(t.batchId, t.position),
  ]
);

/** Append-only corrections preserve the prior value and the original source. */
export const clinicalCorrections = sqliteTable(
  'clinical_corrections',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    recordId: text('record_id').notNull(),
    batchItemId: text('batch_item_id').references(() => importItems.id, { onDelete: 'set null' }),
    before: text('before_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    after: text('after_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    reason: text('reason'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('idx_clinical_corrections_record').on(t.userId, t.domain, t.recordId)]
);
