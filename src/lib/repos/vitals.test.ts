// @vitest-environment node
/**
 * vitals repo — proves requireAuthz wiring (full matrix in authz tests):
 * standard matrix per 003/012: owner full; shares read-only with section
 * 'vitals' + exact dependent match; delegates read (read_only+), write
 * (read_write+), delete (admin). Also: vital_reference_ranges are
 * world-readable seed data; vital_source_preferences are strictly owner-only.
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

type Repo = typeof import('./vitals');

let ctx: RepoTestDb;
let repo: Repo;

const ownScope = { ownerId: OWNER, dependentId: null };

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-vitals-');
  repo = await import('./vitals');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('vitals repo', () => {
  it('owner creates and lists vitals with date-range filters, newest first', async () => {
    await repo.createVital(OWNER, ownScope, {
      metricKey: 'resting_hr',
      value: 61,
      unit: 'bpm',
      source: 'manual',
      recordedAt: '2026-06-01T08:00:00.000Z',
    });
    const newer = await repo.createVital(OWNER, ownScope, {
      metricKey: 'resting_hr',
      value: 58,
      unit: 'bpm',
      source: 'oura',
      recordedAt: '2026-07-01T08:00:00.000Z',
      metadata: { night: true },
    });
    expect(newer.metadata).toEqual({ night: true });

    const all = await repo.listVitals(OWNER, ownScope);
    expect(all.map((v) => v.value)).toEqual([58, 61]); // recorded_at desc

    const windowed = await repo.listVitals(OWNER, ownScope, {
      startDate: '2026-06-15T00:00:00.000Z',
    });
    expect(windowed.map((v) => v.value)).toEqual([58]);

    const until = await repo.listVitals(OWNER, ownScope, {
      endDate: '2026-06-15T00:00:00.000Z',
    });
    expect(until.map((v) => v.value)).toEqual([61]);
  });

  it('dependent scoping is exact; delegate-mode "all" is unfiltered', async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    await repo.createVital(OWNER, ownScope, {
      metricKey: 'weight',
      value: 180,
      source: 'manual',
      recordedAt: '2026-06-01T08:00:00.000Z',
    });
    const depRow = await repo.createVital(
      OWNER,
      { ownerId: OWNER, dependentId: depId },
      {
        metricKey: 'weight',
        value: 62,
        source: 'manual',
        recordedAt: '2026-06-02T08:00:00.000Z',
      },
    );
    expect(depRow.dependentId).toBe(depId);

    expect(await repo.listVitals(OWNER, ownScope)).toHaveLength(1);
    expect(
      await repo.listVitals(OWNER, { ownerId: OWNER, dependentId: depId }),
    ).toHaveLength(1);
    expect(
      await repo.listVitals(OWNER, { ownerId: OWNER, dependentId: 'all' }),
    ).toHaveLength(2);
  });

  it('share grants read with section vitals, exact scope, never write', async () => {
    await repo.createVital(OWNER, ownScope, {
      metricKey: 'resting_hr',
      value: 61,
      source: 'manual',
      recordedAt: '2026-06-01T08:00:00.000Z',
    });
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['vitals'],
      dependentId: null,
    });

    expect(await repo.listVitals(VIEWER, ownScope)).toHaveLength(1);
    await expect(
      repo.listVitals(VIEWER, { ownerId: OWNER, dependentId: 'all' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repo.createVital(VIEWER, ownScope, {
        metricKey: 'weight',
        value: 1,
        source: 'manual',
        recordedAt: '2026-06-01T08:00:00.000Z',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('read_write delegate writes into the owner scope; read_only cannot', async () => {
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'read_write',
    });
    const created = await repo.createVital(VIEWER, ownScope, {
      metricKey: 'bp_systolic',
      value: 120,
      source: 'manual',
      recordedAt: '2026-06-01T08:00:00.000Z',
    });
    expect(created.userId).toBe(OWNER);

    insertDelegate(ctx.sqlite, {
      ownerId: VIEWER,
      delegateUserId: STRANGER,
      permissionLevel: 'read_only',
    });
    await expect(
      repo.createVital(STRANGER, { ownerId: VIEWER, dependentId: null }, {
        metricKey: 'bp_systolic',
        value: 120,
        source: 'manual',
        recordedAt: '2026-06-01T08:00:00.000Z',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('stranger is denied; input is validated and scope keys stripped', async () => {
    await expect(repo.listVitals(STRANGER, ownScope)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      repo.createVital(OWNER, ownScope, { metricKey: 'x', value: 'high' }),
    ).rejects.toThrow();

    const row = await repo.createVital(OWNER, ownScope, {
      metricKey: 'weight',
      value: 180,
      source: 'manual',
      recordedAt: '2026-06-01T08:00:00.000Z',
      userId: STRANGER, // must be ignored
      dependentId: crypto.randomUUID(), // must be ignored
    } as never);
    expect(row.userId).toBe(OWNER);
    expect(row.dependentId).toBeNull();
    expect(row.metadata).toEqual({});
  });

  it('reference ranges are world-readable seed data (no authz)', async () => {
    const ranges = await repo.listVitalReferenceRanges();
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges.some((r) => r.metricKey === 'bp_systolic')).toBe(true);
  });

  it('source preferences: owner-only upsert keyed by user+metric', async () => {
    const created = await repo.setVitalSourcePreference(OWNER, 'resting_hr', 'oura');
    expect(created.preferredSource).toBe('oura');

    // upsert: same metric updates in place
    const updated = await repo.setVitalSourcePreference(OWNER, 'resting_hr', 'manual');
    expect(updated.id).toBe(created.id);
    expect(updated.preferredSource).toBe('manual');

    await repo.setVitalSourcePreference(VIEWER, 'resting_hr', 'oura');
    const mine = await repo.listVitalSourcePreferences(OWNER);
    expect(mine).toHaveLength(1);
    expect(mine[0].preferredSource).toBe('manual');
  });
});
