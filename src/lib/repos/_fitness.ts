/**
 * Shared helpers for the fitness-domain repositories (workouts, exercises,
 * checkins, goals) — validation error types, set-shape schema, and the
 * week/timestamp rules from the fitness design spec §Error handling.
 */
import { z } from 'zod';
import type { DB } from '@/db';
import { camelToSnakeKey } from '@/lib/api/snake';

/** 400-shaped validation failure for fitness write paths. Messages use the
    API wire field names (snake_case) so they can be returned verbatim —
    mirrors VitalWriteError in src/lib/repos/vitals.ts. */
export class FitnessWriteError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'FitnessWriteError';
  }
}

/** 409-shaped conflict (goal uniqueness, PATCH dedupe collisions). */
export class FitnessConflictError extends Error {
  readonly status = 409;
  constructor(
    message: string,
    /** id of the resource the write collided with, when known. */
    readonly existingId?: string,
  ) {
    super(message);
    this.name = 'FitnessConflictError';
  }
}

/** A drizzle handle usable inside better-sqlite3 sync transactions: the
    shared `db` singleton or a transaction handle from `db.transaction`. */
export type FitnessDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

/** Parse with `schema`, converting ZodError into a FitnessWriteError whose
    message names fields in snake_case (API wire format). */
export function parseFitness<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(
        (i) =>
          `${i.path.map((p) => camelToSnakeKey(String(p))).join('.') || 'body'}: ${i.message}`,
      )
      .join('; ');
    throw new FitnessWriteError(`Invalid ${what} — ${detail}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Set shape — spec §exercise_entries: JSON array of
// {weight?, reps?, seconds?, perSide?, warmup?}; only known keys allowed,
// numbers positive. A set must carry at least one measurement.
// ---------------------------------------------------------------------------

export const exerciseSetSchema = z
  .strictObject({
    weight: z.number().positive().finite().optional(),
    reps: z.number().int().positive().optional(),
    seconds: z.number().positive().finite().optional(),
    perSide: z.boolean().optional(),
    warmup: z.boolean().optional(),
  })
  .refine((s) => s.weight !== undefined || s.reps !== undefined || s.seconds !== undefined, {
    message: 'a set needs at least one of weight, reps or seconds',
  });

export const exerciseSetsSchema = z.array(exerciseSetSchema).max(100);

// ---------------------------------------------------------------------------
// Date/timestamp rules
// ---------------------------------------------------------------------------

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** weekStart must be a plain YYYY-MM-DD that falls on a Monday (the Mon–Sun
    week convention; day-of-week of a calendar date is TZ-independent). */
export function validateWeekStart(weekStart: unknown): string {
  if (typeof weekStart !== 'string' || !ISO_DAY.test(weekStart)) {
    throw new FitnessWriteError(`week_start must be a YYYY-MM-DD date (got '${String(weekStart).slice(0, 64)}').`);
  }
  const ts = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(ts.getTime()) || ts.toISOString().slice(0, 10) !== weekStart) {
    throw new FitnessWriteError(`week_start '${weekStart}' is not a valid calendar date.`);
  }
  if (ts.getUTCDay() !== 1) {
    throw new FitnessWriteError(
      `week_start '${weekStart}' is not a Monday — weekly check-ins are keyed to Monday week starts.`,
    );
  }
  return weekStart;
}

/** startedAt: valid ISO datetime, year 1900–2100, normalized to ISO UTC so
    the (user, started_at) dedupe tuple compares consistently. */
export function normalizeStartedAt(startedAt: string): string {
  const ts = new Date(startedAt);
  if (Number.isNaN(ts.getTime())) {
    throw new FitnessWriteError(`started_at '${startedAt.slice(0, 64)}' is not a valid ISO date or datetime.`);
  }
  const year = ts.getUTCFullYear();
  if (year < 1900 || year > 2100) {
    throw new FitnessWriteError(
      `started_at year ${year} is out of range — must be between 1900 and 2100.`,
    );
  }
  return ts.toISOString();
}
