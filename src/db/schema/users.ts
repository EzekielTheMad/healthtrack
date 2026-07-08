/**
 * User-domain tables: profiles, dependents, dashboard_stat_preferences.
 * Sources: 001_initial_schema.sql, 004_dependents.sql,
 * 006_dashboard_stat_prefs.sql, 007_unit_preference.sql.
 */
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  unique,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { uuidPk, timestampNow } from './_shared';

// 001 + 007 (unit_system)
export const profiles = sqliteTable('profiles', {
  // uuid primary key references auth.users on delete cascade (PK = FK)
  id: text('id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  dateOfBirth: text('date_of_birth'),
  biologicalSex: text('biological_sex', { enum: ['male', 'female'] }),
  heightInches: integer('height_inches'),
  weightLbs: real('weight_lbs'),
  // 007: display-layer preference; DB always stores imperial
  unitSystem: text('unit_system', { enum: ['imperial', 'metric'] })
    .notNull()
    .default('imperial'),
  createdAt: timestampNow('created_at'),
  updatedAt: timestampNow('updated_at'),
});

// 004
export const dependents = sqliteTable(
  'dependents',
  {
    id: uuidPk(),
    parentUserId: text('parent_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    dateOfBirth: text('date_of_birth').notNull(),
    biologicalSex: text('biological_sex', { enum: ['male', 'female'] }),
    relationship: text('relationship', {
      enum: ['child', 'spouse', 'parent', 'sibling', 'other'],
    }).notNull(),
    transitionAge: integer('transition_age').notNull().default(18),
    transitioned: integer('transitioned', { mode: 'boolean' }).notNull().default(false),
    // no ON DELETE action in source SQL (default NO ACTION)
    transitionedTo: text('transitioned_to').references(() => user.id),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [index('idx_dependents_parent').on(t.parentUserId)],
);

// 006
export const dashboardStatPreferences = sqliteTable(
  'dashboard_stat_preferences',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    widgetType: text('widget_type', { enum: ['vital', 'lab_result'] })
      .notNull()
      .default('vital'),
    // vital: metric key (e.g. 'resting_hr'); lab: test name
    metricKey: text('metric_key').notNull(),
    position: integer('position').notNull().default(0),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    // uq_dash_stat_dep: dedupe per user+dependent (NULL dependent_id rows are
    // not deduped here — NULLs are distinct in SQLite, same as Postgres)
    unique('uq_dash_stat_dep').on(t.userId, t.dependentId, t.widgetType, t.metricKey),
    // partial unique index dedupes the user's own (dependent IS NULL) rows.
    // Kept partial: SQLite supports partial indexes and flattening this one
    // would wrongly collide self rows with dependent rows.
    uniqueIndex('idx_dash_stat_prefs_self_unique')
      .on(t.userId, t.widgetType, t.metricKey)
      .where(sql`dependent_id is null`),
    index('idx_dash_stat_prefs_user_position').on(t.userId, t.dependentId, t.position),
  ],
);
