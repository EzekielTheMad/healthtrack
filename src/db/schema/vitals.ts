/**
 * Vitals-domain tables: vitals, vital_source_preferences, vital_reference_ranges.
 * Sources: 001_initial_schema.sql, 004_dependents.sql.
 */
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { dependents } from './users';
import { uuidPk, timestampNow } from './_shared';

// 001 + 004
export const vitals = sqliteTable(
  'vitals',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    metricKey: text('metric_key').notNull(),
    value: real('value').notNull(),
    unit: text('unit'),
    source: text('source').notNull(),
    recordedAt: text('recorded_at').notNull(),
    // jsonb not null default '{}'
    metadata: text('metadata', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_vitals_user_metric').on(t.userId, t.metricKey, sql`${t.recordedAt} desc`),
    index('idx_vitals_dependent').on(t.dependentId),
    // Backs the app-level upsert tuple (upsertOwnVital in src/lib/repos/vitals.ts).
    // SQLite treats NULLs as distinct in unique indexes, so the nullable
    // dependent_id is coalesced to '' — owner rows are actually constrained.
    uniqueIndex('idx_vitals_upsert_tuple').on(
      t.userId,
      t.metricKey,
      t.recordedAt,
      t.source,
      sql`coalesce(${t.dependentId}, '')`,
    ),
  ],
);

// 001
export const vitalSourcePreferences = sqliteTable(
  'vital_source_preferences',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    metricKey: text('metric_key').notNull(),
    preferredSource: text('preferred_source').notNull(),
  },
  (t) => [unique('vital_source_preferences_user_metric_unique').on(t.userId, t.metricKey)],
);

// 001 — global reference data (seeded, no user FK)
export const vitalReferenceRanges = sqliteTable('vital_reference_ranges', {
  id: uuidPk(),
  metricKey: text('metric_key').notNull(),
  label: text('label').notNull(),
  unit: text('unit'),
  rangeLow: real('range_low'),
  rangeHigh: real('range_high'),
  ageMin: integer('age_min'),
  ageMax: integer('age_max'),
  sex: text('sex'),
  sourceCitation: text('source_citation'),
  createdAt: timestampNow('created_at'),
});
