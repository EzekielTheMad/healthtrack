// @vitest-environment node
/**
 * weekly check-ins repo — Monday week_start validation, PUT-style upsert
 * keyed on (user, week_start), and neck/waist write-through: accepted by the
 * upsert, stored as manual-source VITALS rows on the submission day, never
 * on the check-in row.
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

type Repo = typeof import('./checkins');

let ctx: RepoTestDb;
let repo: Repo;

const MONDAY = '2026-07-06';
const PRIOR_MONDAY = '2026-06-29';

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-checkins-');
  repo = await import('./checkins');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('checkins repo', () => {
  it('rejects week_start values that are not real Mondays', async () => {
    // Tuesday
    await expect(
      repo.upsertCheckin(OWNER, OWNER, '2026-07-07', {}),
    ).rejects.toMatchObject({ status: 400 });
    // not a date at all
    await expect(
      repo.upsertCheckin(OWNER, OWNER, 'next week', {}),
    ).rejects.toMatchObject({ status: 400 });
    // datetime form is rejected — the key is a plain day
    await expect(
      repo.upsertCheckin(OWNER, OWNER, '2026-07-06T00:00:00Z', {}),
    ).rejects.toMatchObject({ status: 400 });
    // impossible calendar date that Date would roll over to a Monday
    await expect(
      repo.upsertCheckin(OWNER, OWNER, '2026-02-30', {}),
    ).rejects.toMatchObject({ status: 400 });
    // reads validate too
    await expect(repo.getCheckin(OWNER, OWNER, '2026-07-07')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('upserts by (user, weekStart): insert, then full-replace on re-PUT', async () => {
    const created = await repo.upsertCheckin(OWNER, OWNER, MONDAY, {
      working: 'progressive overload on pressing',
      daysLogged: 5,
      avgCalories: 2400,
      avgProteinG: 180,
    });
    expect(created.weekStart).toBe(MONDAY);
    expect(created.avgCalories).toBe(2400);

    const replaced = await repo.upsertCheckin(OWNER, OWNER, MONDAY, {
      working: 'sleep schedule',
      daysLogged: 6,
    });
    expect(replaced.id).toBe(created.id); // same row
    expect(replaced.working).toBe('sleep schedule');
    expect(replaced.daysLogged).toBe(6);
    // PUT semantics: omitted manual fields are cleared
    expect(replaced.avgCalories).toBeNull();
    expect(replaced.avgProteinG).toBeNull();

    const rows = ctx.sqlite
      .prepare('select count(*) as n from weekly_checkins')
      .get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('writes neck/waist through to vitals as manual rows on the submission day, not onto the row', async () => {
    const row = await repo.upsertCheckin(OWNER, OWNER, MONDAY, {
      working: 'all good',
      neckIn: 16.5,
      waistIn: 38.25,
    });
    // never stored on the check-in row
    expect('neckIn' in row).toBe(false);
    expect('waistIn' in row).toBe(false);

    const today = new Date().toISOString().slice(0, 10);
    const vitals = ctx.sqlite
      .prepare(
        'select metric_key, value, unit, source, recorded_at, user_id from vitals order by metric_key',
      )
      .all() as {
      metric_key: string;
      value: number;
      unit: string;
      source: string;
      recorded_at: string;
      user_id: string;
    }[];
    expect(vitals).toHaveLength(2);
    expect(vitals[0]).toMatchObject({
      metric_key: 'neck',
      value: 16.5,
      unit: 'in',
      source: 'manual',
      recorded_at: `${today}T00:00:00Z`,
      user_id: OWNER,
    });
    expect(vitals[1]).toMatchObject({ metric_key: 'waist', value: 38.25 });

    // Re-submitting the same day upserts the vitals row instead of duplicating.
    await repo.upsertCheckin(OWNER, OWNER, MONDAY, { neckIn: 16.25 });
    const necks = ctx.sqlite
      .prepare("select value from vitals where metric_key = 'neck'")
      .all() as { value: number }[];
    expect(necks).toHaveLength(1);
    expect(necks[0].value).toBe(16.25);
  });

  it('rejects invalid manual fields (bounds, non-positive numbers)', async () => {
    await expect(
      repo.upsertCheckin(OWNER, OWNER, MONDAY, { daysLogged: 8 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      repo.upsertCheckin(OWNER, OWNER, MONDAY, { avgCalories: -100 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      repo.upsertCheckin(OWNER, OWNER, MONDAY, { neckIn: 0 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('gets and lists by week range, newest first', async () => {
    await repo.upsertCheckin(OWNER, OWNER, PRIOR_MONDAY, { daysLogged: 4 });
    await repo.upsertCheckin(OWNER, OWNER, MONDAY, { daysLogged: 5 });

    expect((await repo.getCheckin(OWNER, OWNER, MONDAY))?.daysLogged).toBe(5);
    expect(await repo.getCheckin(OWNER, OWNER, '2026-07-13')).toBeNull();

    const all = await repo.listCheckins(OWNER, OWNER);
    expect(all.map((c) => c.weekStart)).toEqual([MONDAY, PRIOR_MONDAY]);
    expect(
      await repo.listCheckins(OWNER, OWNER, { from: '2026-07-01' }),
    ).toHaveLength(1);
    expect(await repo.listCheckins(OWNER, OWNER, { to: '2026-07-01' })).toHaveLength(1);
  });

  it('ownership scoping: strangers 404; delegates read-only', async () => {
    await repo.upsertCheckin(OWNER, OWNER, MONDAY, { daysLogged: 5 });
    await expect(repo.listCheckins(STRANGER, OWNER)).rejects.toMatchObject({ status: 404 });
    await expect(
      repo.upsertCheckin(STRANGER, OWNER, MONDAY, {}),
    ).rejects.toMatchObject({ status: 404 });

    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'read_write',
    });
    expect(await repo.listCheckins(VIEWER, OWNER)).toHaveLength(1);
    await expect(
      repo.upsertCheckin(VIEWER, OWNER, MONDAY, { daysLogged: 1 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
