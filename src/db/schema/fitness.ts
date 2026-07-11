/**
 * Fitness-domain tables: exercises, workout_sessions, exercise_entries,
 * weekly_checkins, goals.
 *
 * Fitness domain schema. §Data
 * model. New domain (no legacy SQL migration) — authorization is encoded in
 * src/lib/authz under the 'fitness' section: owner full; delegates read-only;
 * not shareable.
 *
 * Conventions notes:
 *  - Only workout_sessions carries dependent_id (domain convention); the
 *    exercise catalog, check-ins and goals are strictly per-user.
 *  - exercise_entries have no date column — the session owns time — and no
 *    timestamps (spec).
 *  - Derived values (working weight / top reps / top seconds) are computed on
 *    read in src/lib/repos/workouts.ts, never stored.
 *  - weekly check-ins do NOT store neck/waist — the check-in write path
 *    forwards them to vitals (metric 'neck'/'waist', source 'manual').
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

/** One structured set inside exercise_entries.sets (JSON array). */
export interface ExerciseSet {
  weight?: number;
  reps?: number;
  seconds?: number;
  perSide?: boolean;
  warmup?: boolean;
}

export const SESSION_TYPES = ['strength', 'cardio', 'mobility', 'other'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const EXERCISE_MODES = ['weight', 'time'] as const;
export type ExerciseMode = (typeof EXERCISE_MODES)[number];

export const EXERCISE_REVIEW_STATUSES = ['confirmed', 'unreviewed'] as const;
export type ExerciseReviewStatus = (typeof EXERCISE_REVIEW_STATUSES)[number];

export const GOAL_KINDS = ['metric', 'frequency'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_DIRECTIONS = ['decrease', 'increase', 'maintain'] as const;
export type GoalDirection = (typeof GOAL_DIRECTIONS)[number];

/**
 * Per-user exercise catalog. Name resolution is case-insensitive over
 * name + aliases; resolution uniqueness (no name/alias collisions per user)
 * is enforced at write time in src/lib/repos/exercises.ts, not by an index
 * (aliases live inside a JSON column).
 */
export const exercises = sqliteTable(
  'exercises',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    variant: text('variant'),
    mode: text('mode', { enum: EXERCISE_MODES }).notNull().default('weight'),
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
    reviewStatus: text('review_status', { enum: EXERCISE_REVIEW_STATUSES })
      .notNull()
      .default('confirmed'),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [index('idx_exercises_user').on(t.userId)],
);

export const workoutSessions = sqliteTable(
  'workout_sessions',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    type: text('type', { enum: SESSION_TYPES }).notNull(),
    label: text('label'),
    /** Real timestamp (ISO UTC), rendered local. */
    startedAt: text('started_at').notNull(),
    durationMin: real('duration_min'),
    energy: integer('energy'),
    notes: text('notes'),
    // Cardio fields — all nullable.
    distanceMi: real('distance_mi'),
    avgHr: real('avg_hr'),
    calories: real('calories'),
    steps: integer('steps'),
    machine: text('machine'),
    perceivedEffort: integer('perceived_effort'),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    index('idx_workout_sessions_user_started').on(t.userId, sql`${t.startedAt} desc`),
    index('idx_workout_sessions_dependent').on(t.dependentId),
    // Dedupe backstop for agent writers (they keep query-before-create).
    // SQLite treats NULLs as distinct in unique indexes, so the nullable
    // dependent_id is coalesced to '' — owner rows are actually constrained.
    uniqueIndex('idx_workout_sessions_dedupe').on(
      t.userId,
      t.startedAt,
      sql`coalesce(${t.dependentId}, '')`,
    ),
  ],
);

export const exerciseEntries = sqliteTable(
  'exercise_entries',
  {
    id: uuidPk(),
    sessionId: text('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id),
    /** Order within the session (0-based, array order at write time). */
    position: integer('position').notNull(),
    sets: text('sets', { mode: 'json' }).$type<ExerciseSet[]>().notNull().default([]),
    /** Original shorthand verbatim — ground truth for the structured sets. */
    rawSets: text('raw_sets'),
    notes: text('notes'),
  },
  (t) => [
    index('idx_exercise_entries_session').on(t.sessionId),
    index('idx_exercise_entries_exercise').on(t.exerciseId),
  ],
);

export const weeklyCheckins = sqliteTable(
  'weekly_checkins',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Monday, YYYY-MM-DD (owner-TZ week anchor) — validated in the repo. */
    weekStart: text('week_start').notNull(),
    working: text('working'),
    notWorking: text('not_working'),
    daysLogged: integer('days_logged'),
    avgCalories: real('avg_calories'),
    avgProteinG: real('avg_protein_g'),
    avgCarbsG: real('avg_carbs_g'),
    avgFatG: real('avg_fat_g'),
    avgFiberG: real('avg_fiber_g'),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [unique('weekly_checkins_user_week_unique').on(t.userId, t.weekStart)],
);

/**
 * Goals — metric kind (metricKey/direction/targetValue/targetDate) or
 * frequency kind (sessionType/perWeek). Kind-specific columns are nullable;
 * shape and the at-most-one-active-per-key constraints are enforced in
 * src/lib/repos/goals.ts.
 */
export const goals = sqliteTable(
  'goals',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: GOAL_KINDS }).notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    // Metric kind
    metricKey: text('metric_key'),
    direction: text('direction', { enum: GOAL_DIRECTIONS }),
    targetValue: real('target_value'),
    targetDate: text('target_date'),
    // Frequency kind
    sessionType: text('session_type', { enum: SESSION_TYPES }),
    perWeek: integer('per_week'),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [index('idx_goals_user').on(t.userId)],
);
