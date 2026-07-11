// @vitest-environment node
/**
 * exercises repo — per-user catalog with case-insensitive resolution
 * uniqueness over name + aliases (spec §exercises): collisions rejected at
 * write time; alias editing validates against every other catalog entry but
 * not the exercise itself.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertDelegate,
  OWNER,
  VIEWER,
  STRANGER,
  type RepoTestDb,
} from './repo-test-harness';

type Repo = typeof import('./exercises');
type DbModule = typeof import('@/db');

let ctx: RepoTestDb;
let repo: Repo;
let db: DbModule['db'];

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-exercises-');
  repo = await import('./exercises');
  db = (await import('@/db')).db;
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('exercises repo', () => {
  it('creates catalog entries with defaults and lists them name-ordered', async () => {
    await repo.createExercise(OWNER, OWNER, { name: 'Seated row', variant: 'Hammer high' });
    const pushup = await repo.createExercise(OWNER, OWNER, {
      name: 'Plank',
      mode: 'time',
      aliases: ['Front plank'],
    });
    expect(pushup.mode).toBe('time');
    expect(pushup.reviewStatus).toBe('confirmed');
    expect(pushup.aliases).toEqual(['Front plank']);

    const rows = await repo.listExercises(OWNER);
    expect(rows.map((r) => r.name)).toEqual(['Plank', 'Seated row']);
  });

  it('rejects names/aliases colliding case-insensitively with existing entries', async () => {
    await repo.createExercise(OWNER, OWNER, {
      name: 'Chest press',
      aliases: ['Machine chest press'],
    });
    // name vs existing name
    await expect(
      repo.createExercise(OWNER, OWNER, { name: 'chest PRESS' }),
    ).rejects.toMatchObject({ status: 400 });
    // name vs existing alias
    await expect(
      repo.createExercise(OWNER, OWNER, { name: 'machine chest press' }),
    ).rejects.toMatchObject({ status: 400 });
    // alias vs existing name
    await expect(
      repo.createExercise(OWNER, OWNER, { name: 'Incline press', aliases: ['Chest Press'] }),
    ).rejects.toMatchObject({ status: 400 });
    // internal duplicate within one submission
    await expect(
      repo.createExercise(OWNER, OWNER, { name: 'Fly', aliases: ['fly'] }),
    ).rejects.toMatchObject({ status: 400 });
    // another user's catalog is a separate namespace
    const other = await repo.createExercise(VIEWER, VIEWER, { name: 'Chest press' });
    expect(other.userId).toBe(VIEWER);
  });

  it('patches aliases with collision validation that excludes the row itself', async () => {
    const row = await repo.createExercise(OWNER, OWNER, {
      name: 'Lat pulldown',
      aliases: ['Pulldown'],
    });
    await repo.createExercise(OWNER, OWNER, { name: 'Seated row' });

    // Re-submitting its own name among the aliases-set is fine (self excluded)
    const updated = await repo.updateExercise(OWNER, row.id, {
      aliases: ['Pulldown', 'Wide-grip pulldown'],
      reviewStatus: 'confirmed',
    });
    expect(updated.aliases).toEqual(['Pulldown', 'Wide-grip pulldown']);

    // ...but colliding with ANOTHER exercise is rejected
    await expect(
      repo.updateExercise(OWNER, row.id, { aliases: ['seated row'] }),
    ).rejects.toMatchObject({ status: 400 });
    // rename collision too
    await expect(
      repo.updateExercise(OWNER, row.id, { name: 'SEATED ROW' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('resolveOrCreateExerciseSync matches names and aliases case-insensitively', async () => {
    const row = await repo.createExercise(OWNER, OWNER, {
      name: 'Chest press',
      aliases: ['Machine chest press'],
    });
    expect(repo.resolveOrCreateExerciseSync(db, OWNER, 'chest press').exercise.id).toBe(row.id);
    expect(
      repo.resolveOrCreateExerciseSync(db, OWNER, '  MACHINE CHEST PRESS ').exercise.id,
    ).toBe(row.id);

    const created = repo.resolveOrCreateExerciseSync(db, OWNER, 'Cable fly');
    expect(created.created).toBe(true);
    expect(created.exercise.reviewStatus).toBe('unreviewed');
    expect(created.exercise.mode).toBe('weight');
    // second resolution finds the auto-created row
    const again = repo.resolveOrCreateExerciseSync(db, OWNER, 'cable FLY');
    expect(again.created).toBe(false);
    expect(again.exercise.id).toBe(created.exercise.id);
  });

  it('ownership scoping: strangers 404, delegates read but cannot write', async () => {
    const row = await repo.createExercise(OWNER, OWNER, { name: 'Squat' });
    await expect(repo.listExercises(STRANGER, OWNER)).rejects.toMatchObject({ status: 404 });
    await expect(repo.getExercise(STRANGER, row.id)).rejects.toMatchObject({ status: 404 });

    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'read_write',
    });
    // fitness is a new section: delegates read, but it is not in the
    // delegate-writable set — even read_write delegates cannot mutate.
    expect(await repo.listExercises(VIEWER, OWNER)).toHaveLength(1);
    await expect(
      repo.createExercise(VIEWER, OWNER, { name: 'Deadlift' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repo.updateExercise(VIEWER, row.id, { name: 'Back squat' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
