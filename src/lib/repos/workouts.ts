/**
 * workouts repository (workout_sessions + exercise_entries).
 *
 * Authorization: 'fitness' section (new domain, no legacy RLS): owner full;
 * delegates read-only; not shareable. Cross-user probes see 404, list scoping
 * mirrors the vitals repo (dependent-exact or delegate 'all').
 *
 * Fitness domain data layer.
 *  - create takes the session plus nested entries in one call; exercise names
 *    resolve case-insensitively over the owner's catalog (name + aliases) and
 *    unknown names auto-create `unreviewed` catalog rows — a workout write is
 *    never bounced on catalog drift.
 *  - (user, started_at, dependent) collisions return a 409-style dedupe
 *    result carrying the existing resource instead of duplicating it; the
 *    idx_workout_sessions_dedupe unique index is the racing-writer backstop.
 *  - workingWeight / topReps / topSeconds are DERIVED on read from the
 *    heaviest non-warmup set, never stored.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  exerciseEntries,
  exercises,
  workoutSessions,
  SESSION_TYPES,
  type ExerciseSet,
  type SessionType,
} from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';
import {
  exerciseSetsSchema,
  normalizeStartedAt,
  parseFitness,
  FitnessConflictError,
  type FitnessDb,
} from './_fitness';
import { resolveOrCreateExerciseSync, type ExerciseRow } from './exercises';

export type WorkoutSessionRow = typeof workoutSessions.$inferSelect;
export type ExerciseEntryRow = typeof exerciseEntries.$inferSelect;

/** Resolved exercise info nested in read results. */
export interface EntryExerciseInfo {
  id: string;
  name: string;
  variant: string | null;
  mode: 'weight' | 'time';
  reviewStatus: 'confirmed' | 'unreviewed';
}

/** Derived from the heaviest non-warmup set — computed on read, never stored. */
export interface DerivedEntryStats {
  workingWeight: number | null;
  topReps: number | null;
  topSeconds: number | null;
}

export interface ResolvedEntry extends ExerciseEntryRow, DerivedEntryStats {
  exercise: EntryExerciseInfo;
}

export interface WorkoutWithEntries extends WorkoutSessionRow {
  entries: ResolvedEntry[];
}

export interface CreateWorkoutResult {
  /** false = (user, started_at) dedupe hit; `workout` is the EXISTING
      resource (409-style: route responds 409 with it as the body). */
  created: boolean;
  workout: WorkoutWithEntries;
}

// ---------------------------------------------------------------------------
// Validation (spec §Error handling: enums, 1-5 bounds, set shape; unknown
// keys stripped — row scope is never client-controlled)
// ---------------------------------------------------------------------------

const sessionFieldsSchema = z
  .object({
    type: z.enum(SESSION_TYPES),
    label: z.string().trim().min(1).max(200).nullish(),
    startedAt: z.string().min(1),
    durationMin: z.number().positive().finite().max(1600).nullish(),
    energy: z.number().int().min(1).max(5).nullish(),
    notes: z.string().max(4000).nullish(),
    distanceMi: z.number().positive().finite().nullish(),
    avgHr: z.number().positive().finite().nullish(),
    calories: z.number().positive().finite().nullish(),
    steps: z.number().int().positive().nullish(),
    machine: z.string().trim().min(1).max(120).nullish(),
    perceivedEffort: z.number().int().min(1).max(5).nullish(),
  })
  .strip();

const entryInputSchema = z
  .object({
    exerciseName: z.string().trim().min(1).max(120),
    sets: exerciseSetsSchema.default([]),
    rawSets: z.string().max(1000).nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .strip();

const workoutCreateSchema = sessionFieldsSchema.extend({
  entries: z.array(entryInputSchema).max(100).default([]),
});

const workoutUpdateSchema = sessionFieldsSchema.partial().extend({
  /** Present = FULL entry replacement (spec: PATCH accepts partial session
      fields and full entry replacement); absent = entries untouched. */
  entries: z.array(entryInputSchema).max(100).optional(),
});

export type WorkoutInput = z.input<typeof workoutCreateSchema>;
export type WorkoutEntryInput = z.input<typeof entryInputSchema>;

// ---------------------------------------------------------------------------
// Derived stats
// ---------------------------------------------------------------------------

/**
 * workingWeight = weight of the heaviest non-warmup set; topReps = that
 * set's reps (max reps among sets tied at the top weight). Time-mode
 * exercises derive topSeconds (max seconds over non-warmup sets) instead.
 * perSide does not multiply — the stored per-side weight is the number the
 * owner tracks. Entries with no qualifying sets derive nulls.
 */
export function deriveEntryStats(
  mode: 'weight' | 'time',
  sets: ExerciseSet[],
): DerivedEntryStats {
  const working = sets.filter((s) => !s.warmup);
  if (mode === 'time') {
    const secs = working
      .map((s) => s.seconds)
      .filter((v): v is number => typeof v === 'number');
    return {
      workingWeight: null,
      topReps: null,
      topSeconds: secs.length ? Math.max(...secs) : null,
    };
  }
  const weighted = working.filter((s) => typeof s.weight === 'number');
  if (weighted.length === 0) return { workingWeight: null, topReps: null, topSeconds: null };
  const workingWeight = Math.max(...weighted.map((s) => s.weight as number));
  const repsAtTop = weighted
    .filter((s) => s.weight === workingWeight)
    .map((s) => s.reps)
    .filter((v): v is number => typeof v === 'number');
  return {
    workingWeight,
    topReps: repsAtTop.length ? Math.max(...repsAtTop) : null,
    topSeconds: null,
  };
}

function toResolvedEntry(entry: ExerciseEntryRow, exercise: ExerciseRow): ResolvedEntry {
  return {
    ...entry,
    exercise: {
      id: exercise.id,
      name: exercise.name,
      variant: exercise.variant,
      mode: exercise.mode,
      reviewStatus: exercise.reviewStatus,
    },
    ...deriveEntryStats(exercise.mode, entry.sets),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function hydrateSessions(sessions: WorkoutSessionRow[]): Promise<WorkoutWithEntries[]> {
  if (sessions.length === 0) return [];
  const rows = await db
    .select({ entry: exerciseEntries, exercise: exercises })
    .from(exerciseEntries)
    .innerJoin(exercises, eq(exerciseEntries.exerciseId, exercises.id))
    .where(
      inArray(
        exerciseEntries.sessionId,
        sessions.map((s) => s.id),
      ),
    )
    .orderBy(asc(exerciseEntries.position));
  const bySession = new Map<string, ResolvedEntry[]>();
  for (const { entry, exercise } of rows) {
    const group = bySession.get(entry.sessionId) ?? [];
    group.push(toResolvedEntry(entry, exercise));
    bySession.set(entry.sessionId, group);
  }
  return sessions.map((s) => ({ ...s, entries: bySession.get(s.id) ?? [] }));
}

export interface ListWorkoutsOptions {
  /** Inclusive started_at lower bound (ISO string). */
  from?: string;
  /** Inclusive started_at upper bound (ISO string). */
  to?: string;
  type?: SessionType;
  /** Exact label match (v1 API `?label=`). */
  label?: string;
  limit?: number;
}

export async function listWorkouts(
  actorId: string,
  scope: ListScope,
  opts: ListWorkoutsOptions = {},
): Promise<WorkoutWithEntries[]> {
  await requireListAuthz(actorId, scope, 'fitness', 'read');
  const query = db
    .select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, scope.ownerId),
        dependentFilter(workoutSessions.dependentId, scope.dependentId),
        opts.type ? eq(workoutSessions.type, opts.type) : undefined,
        opts.label !== undefined ? eq(workoutSessions.label, opts.label) : undefined,
        opts.from ? gte(workoutSessions.startedAt, opts.from) : undefined,
        opts.to ? lte(workoutSessions.startedAt, opts.to) : undefined,
      ),
    )
    .orderBy(desc(workoutSessions.startedAt));
  const sessions = await (opts.limit !== undefined ? query.limit(opts.limit) : query);
  return hydrateSessions(sessions);
}

/** Row scope comes from the row itself (parity with by-id ops elsewhere). */
async function loadSession(id: string): Promise<WorkoutSessionRow> {
  const rows = await db
    .select()
    .from(workoutSessions)
    .where(eq(workoutSessions.id, id))
    .limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function getWorkout(actorId: string, id: string): Promise<WorkoutWithEntries> {
  const row = await loadSession(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'fitness',
    'read',
  );
  const [workout] = await hydrateSessions([row]);
  return workout;
}

/** One history item for GET /exercises/{id}/history — the entry plus its
    session's when/what, with derived stats. */
export interface ExerciseHistoryItem extends ResolvedEntry {
  session: { id: string; startedAt: string; type: SessionType; label: string | null };
}

/** Recent entries for one exercise, newest session first (an agent's "latest
    entry per exercise" in one call). Ownership comes from the catalog row. */
export async function listExerciseHistory(
  actorId: string,
  exerciseId: string,
  opts: { limit?: number } = {},
): Promise<ExerciseHistoryItem[]> {
  const catalogRows = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, exerciseId))
    .limit(1);
  const exercise = catalogRows[0];
  if (!exercise) throw new NotFoundError();
  await requireAuthz(
    actorId,
    { ownerId: exercise.userId, dependentId: null },
    'fitness',
    'read',
  );
  const rows = await db
    .select({ entry: exerciseEntries, session: workoutSessions })
    .from(exerciseEntries)
    .innerJoin(workoutSessions, eq(exerciseEntries.sessionId, workoutSessions.id))
    .where(eq(exerciseEntries.exerciseId, exerciseId))
    .orderBy(desc(workoutSessions.startedAt), asc(exerciseEntries.position))
    .limit(opts.limit ?? 20);
  return rows.map(({ entry, session }) => ({
    ...toResolvedEntry(entry, exercise),
    session: {
      id: session.id,
      startedAt: session.startedAt,
      type: session.type,
      label: session.label,
    },
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Sync lookup of the dedupe tuple (user, started_at, dependent). */
function findByStartSync(
  dbh: FitnessDb,
  scope: { ownerId: string; dependentId: string | null },
  startedAt: string,
): WorkoutSessionRow | undefined {
  return dbh
    .select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, scope.ownerId),
        eq(workoutSessions.startedAt, startedAt),
        scope.dependentId === null
          ? isNull(workoutSessions.dependentId)
          : eq(workoutSessions.dependentId, scope.dependentId),
      ),
    )
    .get();
}

function insertEntriesSync(
  dbh: FitnessDb,
  ownerId: string,
  sessionId: string,
  entries: z.output<typeof entryInputSchema>[],
): void {
  entries.forEach((e, position) => {
    // Resolution + auto-create always target the OWNER's catalog, also for
    // dependent-scoped sessions (the catalog is per-user, spec §exercises).
    const { exercise } = resolveOrCreateExerciseSync(dbh, ownerId, e.exerciseName);
    dbh
      .insert(exerciseEntries)
      .values({
        sessionId,
        exerciseId: exercise.id,
        position,
        sets: e.sets,
        rawSets: e.rawSets ?? null,
        notes: e.notes ?? null,
      })
      .run();
  });
}

/**
 * Create a session plus nested entries in one transaction. On a
 * (user, started_at, dependent) collision no write happens and the result
 * carries the existing workout with `created: false` — the route turns that
 * into a 409 with the existing resource as the body.
 */
export async function createWorkout(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<CreateWorkoutResult> {
  await requireAuthz(actorId, scope, 'fitness', 'write');
  const { entries, ...session } = parseFitness(workoutCreateSchema, input, 'workout');
  const startedAt = normalizeStartedAt(session.startedAt);

  const result = db.transaction((tx) => {
    const existing = findByStartSync(tx, scope, startedAt);
    if (existing) return { created: false, id: existing.id };
    const row = tx
      .insert(workoutSessions)
      .values({
        ...session,
        startedAt,
        userId: scope.ownerId,
        dependentId: scope.dependentId,
      })
      .returning()
      .get();
    insertEntriesSync(tx, scope.ownerId, row.id, entries);
    return { created: true, id: row.id };
  });

  const workout = await getWorkoutUnchecked(result.id);
  return { created: result.created, workout };
}

/** Hydrate by id without re-running authz (caller already authorized). */
async function getWorkoutUnchecked(id: string): Promise<WorkoutWithEntries> {
  const [workout] = await hydrateSessions([await loadSession(id)]);
  return workout;
}

/**
 * PATCH: partial session fields; `entries`, when present, is a FULL
 * replacement (old entries deleted, new ones resolved + inserted). Moving
 * started_at onto another session's dedupe tuple throws a 409-shaped
 * FitnessConflictError naming the existing session.
 */
export async function updateWorkout(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<WorkoutWithEntries> {
  const row = await loadSession(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'fitness',
    'write',
  );
  const { entries, ...fields } = parseFitness(workoutUpdateSchema, updates, 'workout');
  const startedAt =
    fields.startedAt !== undefined ? normalizeStartedAt(fields.startedAt) : undefined;

  db.transaction((tx) => {
    if (startedAt !== undefined && startedAt !== row.startedAt) {
      const clash = tx
        .select()
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, row.userId),
            eq(workoutSessions.startedAt, startedAt),
            row.dependentId === null
              ? isNull(workoutSessions.dependentId)
              : eq(workoutSessions.dependentId, row.dependentId),
            ne(workoutSessions.id, row.id),
          ),
        )
        .get();
      if (clash) {
        throw new FitnessConflictError(
          `A workout session already exists at started_at '${startedAt}'.`,
          clash.id,
        );
      }
    }
    tx.update(workoutSessions)
      .set({
        ...fields,
        ...(startedAt !== undefined ? { startedAt } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(workoutSessions.id, id))
      .run();
    if (entries !== undefined) {
      tx.delete(exerciseEntries).where(eq(exerciseEntries.sessionId, id)).run();
      insertEntriesSync(tx, row.userId, id, entries);
    }
  });

  return getWorkoutUnchecked(id);
}

/** Delete a session (entries cascade). Owner-only in practice — delegates
    never hold 'delete' on the fitness section. */
export async function deleteWorkout(actorId: string, id: string): Promise<void> {
  const row = await loadSession(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'fitness',
    'delete',
  );
  await db.delete(workoutSessions).where(eq(workoutSessions.id, id));
}
