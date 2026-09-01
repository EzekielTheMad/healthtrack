/**
 * Nutrition domain: nutrition_daily.
 *
 * Canonical ACTUAL INTAKE, one row per (user, Phoenix calendar date, source
 * package) — a DAILY SNAPSHOT, not an append-only stream of partial totals
 * (PRD §6.7). Every sync recalculates the whole affected day from the
 * retained deduplicated raw records and OVERWRITES this row; an incoming
 * subtotal is never added to the stored total, because webhook batches
 * overlap, retry, and carry only changed records.
 *
 * Nutrition is deliberately NOT a vitals metric: the vitals registry is a
 * closed set of point-in-time measurements keyed on
 * (metric, recorded_at, source), which cannot express "recompute the day".
 *
 * Null vs zero is meaningful: a missing nutrient is UNKNOWN, not 0, so every
 * nutrient column is nullable and normalization never coerces null to zero.
 *
 * Authorization: owner-only (no share/delegate grants, no dependent column) —
 * the same posture as vital_source_preferences. Reads go through
 * src/lib/repos/nutrition.ts, which keys on user_id directly.
 */
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { uuidPk, timestampNow } from './_shared';

export const nutritionDaily = sqliteTable(
  'nutrition_daily',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Owner-local calendar date (America/Phoenix), 'YYYY-MM-DD'. */
    date: text('date').notNull(),
    /** Exact Android package that owns this day's intake, e.g. 'com.sbs.diet'. */
    sourcePackage: text('source_package').notNull(),
    calories: real('calories'),
    proteinGrams: real('protein_grams'),
    carbsGrams: real('carbs_grams'),
    fatGrams: real('fat_grams'),
    // Nullable forward-compatible nutrients. The published relay schema does
    // not promise these yet (PRD §6.7) — they stay NULL until it does, so the
    // relay can be extended without a destructive migration.
    fiberGrams: real('fiber_grams'),
    sugarGrams: real('sugar_grams'),
    sodiumMilligrams: real('sodium_milligrams'),
    /** How many raw source records this day's totals were computed from. */
    recordCount: integer('record_count').notNull().default(0),
    metadata: text('metadata_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    index('idx_nutrition_daily_user_date').on(t.userId, t.date),
    uniqueIndex('idx_nutrition_daily_unique').on(t.userId, t.date, t.sourcePackage),
  ],
);
