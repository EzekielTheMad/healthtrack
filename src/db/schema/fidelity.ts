/** HF sidecars deliberately leave legacy exact-number/day-upsert tables intact. */
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { dependents } from './users';
import type {
  ClinicalFact,
  ClinicalIntake,
  ScanInput,
  ScanMeasurement,
} from '@/lib/fidelity/contracts';
const subject = () => ({
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
});
export const clinicalRecords = sqliteTable(
  'clinical_records',
  {
    id: text('id').primaryKey(),
    ...subject(),
    kind: text('kind').notNull(),
    payload: text('payload_json', { mode: 'json' }).$type<ClinicalFact>().notNull(),
    revision: integer('revision').notNull().default(1),
    sourceKey: text('source_key'),
    legacyTable: text('legacy_table'),
    legacyId: text('legacy_id'),
    legacyRevision: text('legacy_revision'),
    receivedAt: text('received_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('idx_clinical_records_subject').on(t.userId, t.dependentId, t.kind),
    uniqueIndex('idx_clinical_record_source')
      .on(t.userId, sql`coalesce(${t.dependentId},'')`, t.sourceKey)
      .where(sql`${t.sourceKey} IS NOT NULL`),
    uniqueIndex('idx_clinical_legacy_overlay')
      .on(t.userId, sql`coalesce(${t.dependentId},'')`, t.legacyTable, t.legacyId)
      .where(sql`${t.legacyId} IS NOT NULL`),
  ]
);
export const clinicalIntakeBatches = sqliteTable(
  'clinical_intake_batches',
  {
    id: text('id').primaryKey(),
    ...subject(),
    externalId: text('external_id').notNull(),
    version: integer('version').notNull().default(1),
    payload: text('payload_json', { mode: 'json' }).$type<ClinicalIntake>().notNull(),
    digest: text('digest').notNull(),
    receivedAt: text('received_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    approvedAt: text('approved_at'),
    approvedDigest: text('approved_digest'),
  },
  (t) => [
    uniqueIndex('idx_clinical_intake_identity').on(
      t.userId,
      sql`coalesce(${t.dependentId},'')`,
      t.externalId
    ),
  ]
);
export const clinicalIntakeItems = sqliteTable(
  'clinical_intake_items',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => clinicalIntakeBatches.id, { onDelete: 'cascade' }),
    itemKey: text('item_key').notNull(),
    payload: text('payload_json', { mode: 'json' })
      .$type<ClinicalIntake['items'][number]>()
      .notNull(),
    status: text('status').notNull().default('pending'),
    recordId: text('record_id'),
    outcome: text('outcome_json', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [uniqueIndex('clinical_intake_items_batch_id_item_key_unique').on(t.batchId, t.itemKey)]
);
export const bodyScans = sqliteTable(
  'body_scans',
  {
    id: text('id').primaryKey(),
    ...subject(),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    payload: text('payload_json', { mode: 'json' }).$type<ScanInput>().notNull(),
    normalized: text('normalized_json', { mode: 'json' }).$type<ScanMeasurement[]>().notNull(),
    revision: text('revision').notNull(),
    receivedAt: text('received_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_body_scan_identity').on(
      t.userId,
      sql`coalesce(${t.dependentId},'')`,
      t.source,
      t.externalId
    ),
    index('idx_body_scan_subject').on(t.userId, t.dependentId, t.receivedAt),
  ]
);
