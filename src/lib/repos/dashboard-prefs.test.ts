// @vitest-environment node
/**
 * dashboard_stat_preferences repo — owner-only domain (no RLS section, no
 * share/delegate policies existed for this table in 006).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  STRANGER,
  T,
  type RepoTestDb,
} from './repo-test-harness';

type Repo = typeof import('./dashboard-prefs');

let ctx: RepoTestDb;
let repo: Repo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-dashprefs-');
  repo = await import('./dashboard-prefs');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('dashboard-prefs repo', () => {
  it('owner bulk-creates, lists by position, updates, deletes', async () => {
    const created = await repo.createDashboardPrefs(OWNER, null, [
      { metricKey: 'resting_hr', position: 1 },
      { metricKey: 'sleep_score', position: 0 },
    ]);
    expect(created).toHaveLength(2);

    const listed = await repo.listDashboardPrefs(OWNER, null);
    expect(listed.map((p) => p.metricKey)).toEqual(['sleep_score', 'resting_hr']);
    expect(listed[0].widgetType).toBe('vital');

    const updated = await repo.updateDashboardPref(OWNER, listed[0].id, {
      pinned: true,
      position: 5,
    });
    expect(updated.pinned).toBe(true);
    expect(updated.position).toBe(5);
    expect(updated.updatedAt >= listed[0].updatedAt).toBe(true);

    await repo.deleteDashboardPref(OWNER, listed[1].id);
    expect(await repo.listDashboardPrefs(OWNER, null)).toHaveLength(1);
  });

  it('scopes rows per dependent, requiring the dependent to be owned', async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);

    await repo.createDashboardPrefs(OWNER, null, [{ metricKey: 'self_metric' }]);
    await repo.createDashboardPrefs(OWNER, depId, [{ metricKey: 'dep_metric' }]);

    expect((await repo.listDashboardPrefs(OWNER, null)).map((p) => p.metricKey)).toEqual([
      'self_metric',
    ]);
    expect((await repo.listDashboardPrefs(OWNER, depId)).map((p) => p.metricKey)).toEqual([
      'dep_metric',
    ]);

    // someone else's dependent id → denied
    await expect(
      repo.createDashboardPrefs(STRANGER, depId, [{ metricKey: 'x' }]),
    ).rejects.toMatchObject({ status: 404 });
    await expect(repo.listDashboardPrefs(STRANGER, depId)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('cross-user update/delete by id is a 404, not a leak', async () => {
    const [pref] = await repo.createDashboardPrefs(OWNER, null, [
      { metricKey: 'resting_hr' },
    ]);
    await expect(
      repo.updateDashboardPref(STRANGER, pref.id, { visible: false }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(repo.deleteDashboardPref(STRANGER, pref.id)).rejects.toMatchObject({
      status: 404,
    });
    // row untouched
    const [row] = await repo.listDashboardPrefs(OWNER, null);
    expect(row.visible).toBe(true);
  });

  it('validates widget_type at the repo boundary', async () => {
    await expect(
      repo.createDashboardPrefs(OWNER, null, [
        { metricKey: 'x', widgetType: 'bogus' as never },
      ]),
    ).rejects.toThrow();
  });

  it('getDashboardExtras counts sources and dedupes lab tests (latest first)', async () => {
    let extras = await repo.getDashboardExtras(OWNER);
    expect(extras.sourceCount).toBe(0);
    expect(extras.availableLabTests).toEqual([]);

    ctx.sqlite
      .prepare(
        `insert into connected_sources (id, user_id, source_name, status, created_at)
         values (?, ?, 'oura', 'active', ?)`,
      )
      .run(crypto.randomUUID(), OWNER, T);

    const visitId = crypto.randomUUID();
    ctx.sqlite
      .prepare(
        `insert into lab_visits (id, user_id, visit_date, created_at) values (?, ?, '2026-01-01', ?)`,
      )
      .run(visitId, OWNER, T);
    const insertLab = ctx.sqlite.prepare(
      `insert into lab_results (id, user_id, lab_visit_id, test_name, value, unit, flag, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertLab.run(crypto.randomUUID(), OWNER, visitId, 'Glucose', 90, 'mg/dL', 'normal', '2026-01-01T00:00:00Z');
    insertLab.run(crypto.randomUUID(), OWNER, visitId, 'Glucose', 105, 'mg/dL', 'high', '2026-02-01T00:00:00Z');
    // another user's labs must not appear
    insertUser(ctx.sqlite, 'lab-other-user-00000000000000000');
    const otherVisit = crypto.randomUUID();
    ctx.sqlite
      .prepare(
        `insert into lab_visits (id, user_id, visit_date, created_at) values (?, ?, '2026-01-01', ?)`,
      )
      .run(otherVisit, 'lab-other-user-00000000000000000', T);
    insertLab.run(
      crypto.randomUUID(),
      'lab-other-user-00000000000000000',
      otherVisit,
      'TSH',
      2.1,
      'mIU/L',
      'normal',
      T,
    );

    extras = await repo.getDashboardExtras(OWNER);
    expect(extras.sourceCount).toBe(1);
    expect(extras.availableLabTests).toEqual([
      { testName: 'Glucose', unit: 'mg/dL', latestValue: 105, flag: 'high' },
    ]);
  });
});
