// @vitest-environment node
/**
 * goals repo — metric + frequency kinds: closed-registry metricKey
 * validation, kind-shape enforcement, kind immutability, and the
 * at-most-one-ACTIVE goal constraints (per metricKey / per sessionType) with
 * 409-shaped conflicts.
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

type Repo = typeof import('./goals');

let ctx: RepoTestDb;
let repo: Repo;

const weightGoal = {
  kind: 'metric' as const,
  metricKey: 'weight',
  direction: 'decrease' as const,
  targetValue: 175,
  targetDate: '2026-12-31',
};

const liftGoal = { kind: 'frequency' as const, sessionType: 'strength' as const, perWeek: 3 };

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-goals-');
  repo = await import('./goals');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('goals repo', () => {
  it('creates metric and frequency goals (active by default) and lists with filters', async () => {
    const metric = await repo.createGoal(OWNER, OWNER, weightGoal);
    expect(metric.active).toBe(true);
    expect(metric.targetValue).toBe(175);
    const freq = await repo.createGoal(OWNER, OWNER, liftGoal);
    expect(freq.perWeek).toBe(3);
    expect(freq.metricKey).toBeNull();

    expect(await repo.listGoals(OWNER)).toHaveLength(2);
    expect(await repo.listGoals(OWNER, OWNER, { kind: 'metric' })).toHaveLength(1);
    expect(await repo.listGoals(OWNER, OWNER, { active: true })).toHaveLength(2);
  });

  it('validates the closed metric registry, enums and bounds', async () => {
    await expect(
      repo.createGoal(OWNER, OWNER, { ...weightGoal, metricKey: 'quantum_flux' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      repo.createGoal(OWNER, OWNER, { ...weightGoal, direction: 'sideways' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      repo.createGoal(OWNER, OWNER, { ...weightGoal, targetDate: 'someday' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      repo.createGoal(OWNER, OWNER, { ...liftGoal, perWeek: 0 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      repo.createGoal(OWNER, OWNER, { ...liftGoal, sessionType: 'yoga' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('enforces at most one ACTIVE metric goal per metricKey', async () => {
    const existing = await repo.createGoal(OWNER, OWNER, weightGoal);
    await expect(
      repo.createGoal(OWNER, OWNER, { ...weightGoal, direction: 'maintain' }),
    ).rejects.toMatchObject({ status: 409, existingId: existing.id });
    // a different metric is fine
    await repo.createGoal(OWNER, OWNER, {
      kind: 'metric',
      metricKey: 'body_fat_pct',
      direction: 'decrease',
    });
    // an INACTIVE duplicate is fine
    const inactive = await repo.createGoal(OWNER, OWNER, { ...weightGoal, active: false });
    expect(inactive.active).toBe(false);
    // ...but re-activating it conflicts while the first is still active
    await expect(
      repo.updateGoal(OWNER, inactive.id, { active: true }),
    ).rejects.toMatchObject({ status: 409, existingId: existing.id });
    // deactivate the original → activation succeeds
    await repo.updateGoal(OWNER, existing.id, { active: false });
    const activated = await repo.updateGoal(OWNER, inactive.id, { active: true });
    expect(activated.active).toBe(true);
    // other users are a separate namespace
    const theirs = await repo.createGoal(VIEWER, VIEWER, weightGoal);
    expect(theirs.userId).toBe(VIEWER);
  });

  it('enforces at most one ACTIVE frequency goal per sessionType', async () => {
    const existing = await repo.createGoal(OWNER, OWNER, liftGoal);
    await expect(
      repo.createGoal(OWNER, OWNER, { ...liftGoal, perWeek: 4 }),
    ).rejects.toMatchObject({ status: 409, existingId: existing.id });
    // different session type is fine
    await repo.createGoal(OWNER, OWNER, { kind: 'frequency', sessionType: 'cardio', perWeek: 2 });
    // re-keying an active goal onto an occupied sessionType conflicts
    const cardio = (await repo.listGoals(OWNER, OWNER, { kind: 'frequency' })).find(
      (g) => g.sessionType === 'cardio',
    )!;
    await expect(
      repo.updateGoal(OWNER, cardio.id, { sessionType: 'strength' }),
    ).rejects.toMatchObject({ status: 409 });
    // patching the active goal itself (same key) is fine — self is excluded
    const bumped = await repo.updateGoal(OWNER, existing.id, { perWeek: 4 });
    expect(bumped.perWeek).toBe(4);
  });

  it('kind is immutable and fields must match the row kind', async () => {
    const metric = await repo.createGoal(OWNER, OWNER, weightGoal);
    await expect(
      repo.updateGoal(OWNER, metric.id, { perWeek: 3 }),
    ).rejects.toMatchObject({ status: 400 });
    const freq = await repo.createGoal(OWNER, OWNER, liftGoal);
    await expect(
      repo.updateGoal(OWNER, freq.id, { metricKey: 'weight' }),
    ).rejects.toMatchObject({ status: 400 });
    // kind in the patch body is stripped, not honored
    const patched = await repo.updateGoal(OWNER, metric.id, {
      kind: 'frequency',
      direction: 'maintain',
    } as never);
    expect(patched.kind).toBe('metric');
    expect(patched.direction).toBe('maintain');
  });

  it('ownership scoping: strangers 404; delegates read-only', async () => {
    const goal = await repo.createGoal(OWNER, OWNER, weightGoal);
    await expect(repo.listGoals(STRANGER, OWNER)).rejects.toMatchObject({ status: 404 });
    await expect(
      repo.createGoal(STRANGER, OWNER, liftGoal),
    ).rejects.toMatchObject({ status: 404 });

    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'admin',
    });
    expect(await repo.listGoals(VIEWER, OWNER)).toHaveLength(1);
    await expect(
      repo.updateGoal(VIEWER, goal.id, { active: false }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
