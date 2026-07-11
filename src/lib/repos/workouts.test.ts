// @vitest-environment node
/**
 * workouts repo — session + nested entries: alias resolution with
 * auto-create ('unreviewed'), (user, started_at) dedupe result, derived
 * working weight / top reps / top seconds, set-shape validation, PATCH with
 * full entry replacement, and 'fitness'-section ownership scoping.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  insertShare,
  insertDelegate,
  OWNER,
  VIEWER,
  STRANGER,
  type RepoTestDb,
} from './repo-test-harness';

type Repo = typeof import('./workouts');
type ExercisesRepo = typeof import('./exercises');

let ctx: RepoTestDb;
let repo: Repo;
let exercisesRepo: ExercisesRepo;

const ownScope = { ownerId: OWNER, dependentId: null };
const T0 = '2026-07-06T17:30:00.000Z';

const strengthInput = (overrides: Record<string, unknown> = {}) => ({
  type: 'strength' as const,
  label: 'Day A',
  startedAt: T0,
  durationMin: 45,
  energy: 4,
  entries: [
    {
      exerciseName: 'Chest press',
      sets: [
        { weight: 90, reps: 12, warmup: true },
        { weight: 130, reps: 10 },
        { weight: 130, reps: 8 },
      ],
      rawSets: '90x12 warmup, 130x10, 130x8',
    },
  ],
  ...overrides,
});

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-workouts-');
  repo = await import('./workouts');
  exercisesRepo = await import('./exercises');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('createWorkout', () => {
  it('creates the session with nested entries, auto-creating unknown exercises as unreviewed', async () => {
    const result = await repo.createWorkout(OWNER, ownScope, strengthInput());
    expect(result.created).toBe(true);
    const { workout } = result;
    expect(workout.type).toBe('strength');
    expect(workout.entries).toHaveLength(1);
    const entry = workout.entries[0];
    expect(entry.exercise.name).toBe('Chest press');
    expect(entry.exercise.reviewStatus).toBe('unreviewed'); // auto-created
    expect(entry.rawSets).toBe('90x12 warmup, 130x10, 130x8');
    expect(entry.position).toBe(0);

    const catalog = await exercisesRepo.listExercises(OWNER);
    expect(catalog).toHaveLength(1);
  });

  it('resolves exercise names through aliases case-insensitively instead of creating duplicates', async () => {
    const canonical = await exercisesRepo.createExercise(OWNER, OWNER, {
      name: 'Chest press',
      aliases: ['Machine chest press'],
    });
    const { workout } = await repo.createWorkout(
      OWNER,
      ownScope,
      strengthInput({
        entries: [
          { exerciseName: 'machine CHEST press', sets: [{ weight: 100, reps: 10 }] },
          { exerciseName: 'CHEST PRESS', sets: [{ weight: 110, reps: 8 }] },
        ],
      }),
    );
    expect(workout.entries.map((e) => e.exercise.id)).toEqual([canonical.id, canonical.id]);
    expect(workout.entries.map((e) => e.position)).toEqual([0, 1]);
    expect(await exercisesRepo.listExercises(OWNER)).toHaveLength(1);
  });

  it('returns a 409-style dedupe result carrying the existing session on (user, startedAt) collision', async () => {
    const first = await repo.createWorkout(OWNER, ownScope, strengthInput());
    // Same instant written with a different ISO spelling → same tuple.
    const dup = await repo.createWorkout(
      OWNER,
      ownScope,
      strengthInput({ startedAt: '2026-07-06T11:30:00.000-06:00', label: 'Day A retry' }),
    );
    expect(dup.created).toBe(false);
    expect(dup.workout.id).toBe(first.workout.id);
    expect(dup.workout.label).toBe('Day A'); // existing resource, not the retry
    expect(await repo.listWorkouts(OWNER, ownScope)).toHaveLength(1);

    // Different dependent scope at the same instant is NOT a collision.
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    const dep = await repo.createWorkout(
      OWNER,
      { ownerId: OWNER, dependentId: depId },
      strengthInput({ entries: [] }),
    );
    expect(dep.created).toBe(true);
  });

  it('validates enums, 1-5 bounds and set shape (unknown keys, non-positive numbers)', async () => {
    await expect(
      repo.createWorkout(OWNER, ownScope, strengthInput({ type: 'yoga' })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      repo.createWorkout(OWNER, ownScope, strengthInput({ energy: 6 })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      repo.createWorkout(OWNER, ownScope, strengthInput({ perceivedEffort: 0 })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      repo.createWorkout(OWNER, ownScope, strengthInput({ startedAt: 'yesterday' })),
    ).rejects.toMatchObject({ status: 400 });
    // set objects: only known keys
    await expect(
      repo.createWorkout(
        OWNER,
        ownScope,
        strengthInput({
          entries: [{ exerciseName: 'Row', sets: [{ weight: 100, reps: 10, rpe: 8 }] }],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    // numbers must be positive
    await expect(
      repo.createWorkout(
        OWNER,
        ownScope,
        strengthInput({ entries: [{ exerciseName: 'Row', sets: [{ weight: -5, reps: 10 }] }] }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    // a set needs at least one measurement
    await expect(
      repo.createWorkout(
        OWNER,
        ownScope,
        strengthInput({ entries: [{ exerciseName: 'Row', sets: [{ warmup: true }] }] }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    // nothing was written by the failed attempts
    expect(await repo.listWorkouts(OWNER, ownScope)).toHaveLength(0);
    expect(await exercisesRepo.listExercises(OWNER)).toHaveLength(0);
  });

  it('strips client-controlled scope keys', async () => {
    const { workout } = await repo.createWorkout(OWNER, ownScope, {
      ...strengthInput(),
      userId: STRANGER,
      dependentId: crypto.randomUUID(),
      id: 'attacker-chosen',
    } as never);
    expect(workout.userId).toBe(OWNER);
    expect(workout.dependentId).toBeNull();
    expect(workout.id).not.toBe('attacker-chosen');
  });
});

describe('derived fields (read path)', () => {
  it('workingWeight/topReps come from the heaviest non-warmup set; warmups and perSide untouched', async () => {
    const { workout } = await repo.createWorkout(
      OWNER,
      ownScope,
      strengthInput({
        entries: [
          {
            exerciseName: 'Chest press',
            sets: [
              { weight: 200, reps: 12, warmup: true }, // heavier, but warmup
              { weight: 130, reps: 10 },
              { weight: 130, reps: 8 },
              { weight: 120, reps: 12 },
            ],
          },
          {
            // per-side weights are reported as-is, not doubled
            exerciseName: 'Curl',
            sets: [{ weight: 50, reps: 12, perSide: true }],
          },
          {
            // reps-only (bodyweight) → no derived weight
            exerciseName: 'Pushups',
            sets: [{ reps: 20 }, { reps: 15 }],
          },
        ],
      }),
    );
    const [press, curl, pushups] = workout.entries;
    expect(press.workingWeight).toBe(130);
    expect(press.topReps).toBe(10); // max reps among sets tied at top weight
    expect(press.topSeconds).toBeNull();
    expect(curl.workingWeight).toBe(50);
    expect(curl.topReps).toBe(12);
    expect(pushups.workingWeight).toBeNull();
    expect(pushups.topReps).toBeNull();
  });

  it('time-mode exercises derive topSeconds instead', async () => {
    await exercisesRepo.createExercise(OWNER, OWNER, { name: 'Plank', mode: 'time' });
    const { workout } = await repo.createWorkout(
      OWNER,
      ownScope,
      strengthInput({
        entries: [
          {
            exerciseName: 'Plank',
            sets: [{ seconds: 45, warmup: true }, { seconds: 75 }, { seconds: 60 }],
            rawSets: '45s warmup, 75s, 60s',
          },
        ],
      }),
    );
    const plank = workout.entries[0];
    expect(plank.exercise.mode).toBe('time');
    expect(plank.topSeconds).toBe(75); // warmup excluded
    expect(plank.workingWeight).toBeNull();
    expect(plank.topReps).toBeNull();
  });

  it('deriveEntryStats handles empty and all-warmup set lists', () => {
    expect(repo.deriveEntryStats('weight', [])).toEqual({
      workingWeight: null,
      topReps: null,
      topSeconds: null,
    });
    expect(
      repo.deriveEntryStats('weight', [{ weight: 100, reps: 10, warmup: true }]),
    ).toEqual({ workingWeight: null, topReps: null, topSeconds: null });
    expect(repo.deriveEntryStats('time', [{ seconds: 30 }])).toEqual({
      workingWeight: null,
      topReps: null,
      topSeconds: 30,
    });
  });
});

describe('list/get/patch/delete', () => {
  it('lists with from/to/type/label filters, newest first, entries nested', async () => {
    await repo.createWorkout(OWNER, ownScope, strengthInput());
    await repo.createWorkout(OWNER, ownScope, {
      type: 'cardio',
      label: 'Treadmill',
      startedAt: '2026-07-08T07:00:00.000Z',
      durationMin: 30,
      distanceMi: 2.1,
      avgHr: 141,
      perceivedEffort: 3,
    });

    const all = await repo.listWorkouts(OWNER, ownScope);
    expect(all.map((w) => w.type)).toEqual(['cardio', 'strength']); // desc
    expect(all[1].entries).toHaveLength(1);

    expect(
      await repo.listWorkouts(OWNER, ownScope, { from: '2026-07-07T00:00:00Z' }),
    ).toHaveLength(1);
    expect(
      await repo.listWorkouts(OWNER, ownScope, { to: '2026-07-07T00:00:00Z' }),
    ).toHaveLength(1);
    expect(await repo.listWorkouts(OWNER, ownScope, { type: 'cardio' })).toHaveLength(1);
    expect(await repo.listWorkouts(OWNER, ownScope, { label: 'Day A' })).toHaveLength(1);
    expect(await repo.listWorkouts(OWNER, ownScope, { label: 'Day' })).toHaveLength(0); // exact
  });

  it('patches partial session fields and replaces entries wholesale when given', async () => {
    const { workout } = await repo.createWorkout(OWNER, ownScope, strengthInput());
    const patched = await repo.updateWorkout(OWNER, workout.id, { energy: 2, notes: 'rough' });
    expect(patched.energy).toBe(2);
    expect(patched.label).toBe('Day A'); // untouched
    expect(patched.entries).toHaveLength(1); // entries untouched when absent

    const replaced = await repo.updateWorkout(OWNER, workout.id, {
      entries: [
        { exerciseName: 'Squat', sets: [{ weight: 225, reps: 5 }] },
        { exerciseName: 'Chest press', sets: [{ weight: 135, reps: 10 }] },
      ],
    });
    expect(replaced.entries.map((e) => e.exercise.name)).toEqual(['Squat', 'Chest press']);
    expect(replaced.entries.map((e) => e.position)).toEqual([0, 1]);
    expect(replaced.entries[0].workingWeight).toBe(225);
    // old entry rows are gone
    const count = ctx.sqlite
      .prepare('select count(*) as n from exercise_entries')
      .get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('patching startedAt onto another session throws a 409-shaped conflict', async () => {
    const a = await repo.createWorkout(OWNER, ownScope, strengthInput());
    const b = await repo.createWorkout(
      OWNER,
      ownScope,
      strengthInput({ startedAt: '2026-07-08T17:30:00.000Z', entries: [] }),
    );
    await expect(
      repo.updateWorkout(OWNER, b.workout.id, { startedAt: T0 }),
    ).rejects.toMatchObject({ status: 409, existingId: a.workout.id });
    // no-op re-save of its own startedAt is fine
    const saved = await repo.updateWorkout(OWNER, b.workout.id, {
      startedAt: '2026-07-08T17:30:00.000Z',
    });
    expect(saved.id).toBe(b.workout.id);
  });

  it('delete cascades to entries', async () => {
    const { workout } = await repo.createWorkout(OWNER, ownScope, strengthInput());
    await repo.deleteWorkout(OWNER, workout.id);
    await expect(repo.getWorkout(OWNER, workout.id)).rejects.toMatchObject({ status: 404 });
    const count = ctx.sqlite
      .prepare('select count(*) as n from exercise_entries')
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('exercise history returns recent entries with session context, newest first', async () => {
    await repo.createWorkout(OWNER, ownScope, strengthInput());
    await repo.createWorkout(
      OWNER,
      ownScope,
      strengthInput({
        startedAt: '2026-07-08T17:30:00.000Z',
        entries: [{ exerciseName: 'chest press', sets: [{ weight: 135, reps: 9 }] }],
      }),
    );
    const [exercise] = await exercisesRepo.listExercises(OWNER);
    const history = await repo.listExerciseHistory(OWNER, exercise.id, { limit: 5 });
    expect(history).toHaveLength(2);
    expect(history[0].session.startedAt).toBe('2026-07-08T17:30:00.000Z');
    expect(history[0].workingWeight).toBe(135);
    expect(history[1].workingWeight).toBe(130);
    await expect(
      repo.listExerciseHistory(STRANGER, exercise.id),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('ownership scoping (fitness section)', () => {
  it('strangers and vitals-shares are denied; delegates read but never write/delete', async () => {
    const { workout } = await repo.createWorkout(OWNER, ownScope, strengthInput());

    await expect(repo.listWorkouts(STRANGER, ownScope)).rejects.toMatchObject({ status: 404 });
    await expect(repo.getWorkout(STRANGER, workout.id)).rejects.toMatchObject({ status: 404 });

    // A vitals share does NOT leak the (unshareable) fitness section.
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['vitals', 'fitness'],
      dependentId: null,
    });
    await expect(repo.listWorkouts(VIEWER, ownScope)).rejects.toMatchObject({ status: 404 });

    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: STRANGER,
      permissionLevel: 'admin',
    });
    expect(await repo.listWorkouts(STRANGER, ownScope)).toHaveLength(1);
    expect(
      await repo.listWorkouts(STRANGER, { ownerId: OWNER, dependentId: 'all' }),
    ).toHaveLength(1);
    // fitness is not delegate-writable/deletable even at admin level
    await expect(
      repo.createWorkout(STRANGER, ownScope, strengthInput({ startedAt: '2026-07-09T17:00:00Z' })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repo.updateWorkout(STRANGER, workout.id, { energy: 1 }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(repo.deleteWorkout(STRANGER, workout.id)).rejects.toMatchObject({ status: 404 });
  });

  it('dependent scoping is exact', async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    await repo.createWorkout(OWNER, ownScope, strengthInput());
    await repo.createWorkout(
      OWNER,
      { ownerId: OWNER, dependentId: depId },
      strengthInput({ startedAt: '2026-07-07T17:30:00.000Z', entries: [] }),
    );
    expect(await repo.listWorkouts(OWNER, ownScope)).toHaveLength(1);
    expect(
      await repo.listWorkouts(OWNER, { ownerId: OWNER, dependentId: depId }),
    ).toHaveLength(1);
    expect(
      await repo.listWorkouts(OWNER, { ownerId: OWNER, dependentId: 'all' }),
    ).toHaveLength(2);
  });
});

describe('PAT scopes', () => {
  it('exposes read:fitness and write:fitness in AVAILABLE_SCOPES', async () => {
    const { AVAILABLE_SCOPES } = await import('@/lib/api-scopes');
    const values = AVAILABLE_SCOPES.map((s) => s.value);
    expect(values).toContain('read:fitness');
    expect(values).toContain('write:fitness');
    expect(values).toContain('read:vitals'); // pre-existing, required by spec
  });
});
