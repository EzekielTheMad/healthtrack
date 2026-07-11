// ---------------------------------------------------------------------------
// Wire shapes served by the session-authenticated fitness API family
// (/api/workouts, /api/exercises, /api/checkins, /api/weeks, /api/goals).
//
// The fitness routes deep-snake their payloads (deepToSnake), so nested keys
// are snake_case all the way down — including set objects ({ per_side }).
// Client-safe by design: types, literal constants (mirroring the schema
// enums, like focus.ts does) and tiny set-key converters; never imports
// @/db/schema or anything server-side.
// ---------------------------------------------------------------------------

import type { ParsedSet } from './set-parser';

/** Mirrors schema SESSION_TYPES (client copy — see focus.ts convention). */
export const SESSION_TYPE_OPTIONS = ['strength', 'cardio', 'mobility', 'other'] as const;
export type SessionTypeWire = (typeof SESSION_TYPE_OPTIONS)[number];

/** Mirrors schema GOAL_DIRECTIONS. */
export const GOAL_DIRECTION_OPTIONS = ['decrease', 'increase', 'maintain'] as const;
export type GoalDirectionWire = (typeof GOAL_DIRECTION_OPTIONS)[number];

export interface SetWire {
  weight?: number;
  reps?: number;
  seconds?: number;
  per_side?: boolean;
  warmup?: boolean;
}

export interface ExerciseInfoWire {
  id: string;
  name: string;
  variant: string | null;
  mode: 'weight' | 'time';
  review_status: 'confirmed' | 'unreviewed';
}

export interface EntryWire {
  id: string;
  session_id: string;
  exercise_id: string;
  position: number;
  sets: SetWire[];
  raw_sets: string | null;
  notes: string | null;
  working_weight: number | null;
  top_reps: number | null;
  top_seconds: number | null;
  exercise: ExerciseInfoWire;
}

export interface WorkoutWire {
  id: string;
  user_id: string;
  dependent_id: string | null;
  type: SessionTypeWire;
  label: string | null;
  started_at: string;
  duration_min: number | null;
  energy: number | null;
  notes: string | null;
  distance_mi: number | null;
  avg_hr: number | null;
  calories: number | null;
  steps: number | null;
  machine: string | null;
  perceived_effort: number | null;
  entries: EntryWire[];
}

export interface ExerciseWire {
  id: string;
  user_id: string;
  name: string;
  variant: string | null;
  mode: 'weight' | 'time';
  aliases: string[];
  review_status: 'confirmed' | 'unreviewed';
}

export interface ExerciseHistoryItemWire extends EntryWire {
  session: {
    id: string;
    started_at: string;
    type: SessionTypeWire;
    label: string | null;
  };
}

export interface CheckinWire {
  id: string;
  user_id: string;
  week_start: string;
  working: string | null;
  not_working: string | null;
  days_logged: number | null;
  avg_calories: number | null;
  avg_protein_g: number | null;
  avg_carbs_g: number | null;
  avg_fat_g: number | null;
  avg_fiber_g: number | null;
}

export interface LatestMeasurementWire {
  value: number;
  recorded_at: string;
  source: string;
}

export interface FrequencyGoalProgressWire {
  goal_id: string;
  session_type: SessionTypeWire;
  per_week: number;
  completed: number;
  met: boolean;
}

/** GET /api/weeks/{weekStart} — deep-snake of WeekRollup (rollup.ts). */
export interface WeekRollupWire {
  week_start: string;
  week_end: string;
  timezone: string;
  sessions: {
    total: number;
    by_type: Record<SessionTypeWire, { count: number; labels: string[] }>;
  };
  body: {
    weight_avg: number | null;
    weight_min: number | null;
    days_weighed: number;
    body_fat_pct_avg: number | null;
    fat_free_mass_avg: number | null;
    neck_latest: LatestMeasurementWire | null;
    waist_latest: LatestMeasurementWire | null;
  };
  recovery: {
    hrv_rmssd_avg: number | null;
    readiness_score_avg: number | null;
    sleep_score_avg: number | null;
    sleep_duration_avg: number | null;
  };
  frequency_goals: FrequencyGoalProgressWire[];
  checkin: CheckinWire | null;
  prior_week_deltas: {
    weight_avg: number | null;
    weight_min: number | null;
    days_weighed: number | null;
    body_fat_pct_avg: number | null;
    fat_free_mass_avg: number | null;
    hrv_rmssd_avg: number | null;
    readiness_score_avg: number | null;
    sleep_score_avg: number | null;
    sleep_duration_avg: number | null;
    sessions_total: number | null;
  };
}

export interface GoalWire {
  id: string;
  user_id: string;
  kind: 'metric' | 'frequency';
  active: boolean;
  metric_key: string | null;
  direction: GoalDirectionWire | null;
  target_value: number | null;
  target_date: string | null;
  session_type: SessionTypeWire | null;
  per_week: number | null;
  created_at: string;
}

/** Wire set objects (per_side) → the pure libs' ParsedSet shape (perSide). */
export function parsedSetsFromWire(sets: readonly SetWire[]): ParsedSet[] {
  return sets.map(({ per_side, ...rest }) => ({
    ...rest,
    ...(per_side !== undefined ? { perSide: per_side } : {}),
  }));
}

/** ParsedSet (perSide) → wire set objects (per_side) for write payloads. */
export function wireSetsFromParsed(sets: readonly ParsedSet[]): SetWire[] {
  return sets.map(({ perSide, ...rest }) => ({
    ...rest,
    ...(perSide !== undefined ? { per_side: perSide } : {}),
  }));
}
