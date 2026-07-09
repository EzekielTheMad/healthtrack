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
type DbModule = typeof import('@/db');

let ctx: RepoTestDb;
let repo: Repo;
let db: DbModule['db'];

const ownScope = { ownerId: OWNER, dependentId: null };

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-vitals-');
  repo = await import('./vitals');
  db = (await import('@/db')).db;
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

  // I3 — session same-day re-entry must upsert, not silently duplicate.
  describe('createVital same-day re-entry (I3)', () => {
    const entry = (value: number, overrides: Record<string, unknown> = {}) => ({
      metricKey: 'weight',
      value,
      source: 'manual',
      recordedAt: '2026-07-08T09:00:00Z',
      ...overrides,
    });

    it('owner scope: same (metric, day, source) updates in place', async () => {
      const first = await repo.createVital(OWNER, ownScope, entry(180));
      const second = await repo.createVital(OWNER, ownScope, entry(181.5, {
        recordedAt: '2026-07-08T21:00:00Z', // same day, later time
      }));

      expect(second.value).toBe(181.5);
      expect(second.id).toBe(first.id); // same row, not a duplicate
      const rows = await repo.listVitals(OWNER, ownScope);
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe(181.5);
    });

    it("dependent scope: re-entry updates the dependent's row and never touches the owner's", async () => {
      const depId = crypto.randomUUID();
      insertDependent(ctx.sqlite, depId, OWNER);
      const depScope = { ownerId: OWNER, dependentId: depId };

      await repo.createVital(OWNER, ownScope, entry(180));
      await repo.createVital(OWNER, depScope, entry(60));
      const updated = await repo.createVital(OWNER, depScope, entry(61));

      expect(updated.value).toBe(61);
      expect(updated.dependentId).toBe(depId);

      const ownRows = await repo.listVitals(OWNER, ownScope);
      expect(ownRows).toHaveLength(1);
      expect(ownRows[0].value).toBe(180); // owner row untouched

      const depRows = await repo.listVitals(OWNER, depScope);
      expect(depRows).toHaveLength(1);
      expect(depRows[0].value).toBe(61);
    });

    it('a different source on the same day inserts a separate row', async () => {
      await repo.createVital(OWNER, ownScope, entry(180));
      await repo.createVital(OWNER, ownScope, entry(179, { source: 'renpho' }));
      const rows = await repo.listVitals(OWNER, ownScope);
      expect(rows).toHaveLength(2);
    });
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

// ---------------------------------------------------------------------------
// validateVitalWrite — registry-driven validation for the write path
// ---------------------------------------------------------------------------

describe('validateVitalWrite', () => {
  const base = { source: 'test', recordedAt: '2026-07-08T00:00:00Z' };

  it('rejects unknown metric keys, naming the key and pointing at the docs', () => {
    expect(() =>
      repo.validateVitalWrite({ ...base, metricKey: 'quantum_flux', value: 1 }),
    ).toThrow(/quantum_flux[\s\S]*\/docs\/api/);
  });

  it('resolves ordinal labels to values and stamps metadata.label', () => {
    const v = repo.validateVitalWrite({
      ...base,
      metricKey: 'resilience',
      valueLabel: 'solid',
    });
    expect(v.value).toBe(3);
    expect(v.metadata.label).toBe('solid');
    // case-insensitive label matching
    const upper = repo.validateVitalWrite({
      ...base,
      metricKey: 'resilience',
      valueLabel: 'Solid',
    });
    expect(upper.value).toBe(3);
    expect(upper.metadata.label).toBe('solid');
  });

  it('accepts ordinal numeric values within the label range, deriving the label', () => {
    const v = repo.validateVitalWrite({ ...base, metricKey: 'resilience', value: 4 });
    expect(v.metadata.label).toBe('strong');
    expect(() =>
      repo.validateVitalWrite({ ...base, metricKey: 'resilience', value: 6 }),
    ).toThrow(/between 1 and 5/);
    expect(() =>
      repo.validateVitalWrite({ ...base, metricKey: 'resilience', value: 2.5 }),
    ).toThrow(/integer/);
  });

  it('rejects an unknown ordinal label, listing the valid ones', () => {
    expect(() =>
      repo.validateVitalWrite({ ...base, metricKey: 'resilience', valueLabel: 'meh' }),
    ).toThrow(/limited[\s\S]*exceptional/);
  });

  it('rejects value_label on non-ordinal metrics and conflicting value+label', () => {
    expect(() =>
      repo.validateVitalWrite({ ...base, metricKey: 'steps', valueLabel: 'solid' }),
    ).toThrow(/value_label/);
    expect(() =>
      repo.validateVitalWrite({
        ...base,
        metricKey: 'resilience',
        value: 2,
        valueLabel: 'solid',
      }),
    ).toThrow(/does not match/);
  });

  it('requires a value (or value_label for ordinals)', () => {
    expect(() => repo.validateVitalWrite({ ...base, metricKey: 'steps' })).toThrow(/value/);
    expect(() => repo.validateVitalWrite({ ...base, metricKey: 'resilience' })).toThrow(
      /value/,
    );
  });

  it('enforces the pain_level 0-10 range from the registry min/max', () => {
    expect(repo.validateVitalWrite({ ...base, metricKey: 'pain_level', value: 0 }).value).toBe(0);
    expect(repo.validateVitalWrite({ ...base, metricKey: 'pain_level', value: 10 }).value).toBe(10);
    expect(() =>
      repo.validateVitalWrite({ ...base, metricKey: 'pain_level', value: 11 }),
    ).toThrow(/between 0 and 10/);
    expect(() =>
      repo.validateVitalWrite({ ...base, metricKey: 'pain_level', value: -1 }),
    ).toThrow(/between 0 and 10/);
  });

  it('converts weight kg to lbs and always stores the canonical unit', () => {
    const kg = repo.validateVitalWrite({ ...base, metricKey: 'weight', value: 80, unit: 'kg' });
    expect(kg.value).toBeCloseTo(176.4, 5);
    expect(kg.unit).toBe('lbs');
    // omitted unit → canonical filled in
    const bare = repo.validateVitalWrite({ ...base, metricKey: 'steps', value: 100 });
    expect(bare.unit).toBe('steps');
  });

  it('rejects units that differ from the registry canonical unit', () => {
    expect(() =>
      repo.validateVitalWrite({ ...base, metricKey: 'steps', value: 1, unit: 'km' }),
    ).toThrow(/steps/);
    expect(() =>
      repo.validateVitalWrite({ ...base, metricKey: 'resilience', value: 1, unit: 'pts' }),
    ).toThrow(/unit/);
  });

  it('day-normalizes recorded_at except for intraday metrics', () => {
    const steps = repo.validateVitalWrite({
      metricKey: 'steps',
      value: 100,
      source: 'watch',
      recordedAt: '2026-07-08T14:30:00Z',
    });
    expect(steps.recordedAt).toBe('2026-07-08T00:00:00Z');

    const dateOnly = repo.validateVitalWrite({
      metricKey: 'steps',
      value: 100,
      source: 'watch',
      recordedAt: '2026-07-08',
    });
    expect(dateOnly.recordedAt).toBe('2026-07-08T00:00:00Z');

    const glucose = repo.validateVitalWrite({
      metricKey: 'blood_glucose',
      value: 95,
      source: 'cgm',
      recordedAt: '2026-07-08T14:30:00Z',
    });
    expect(glucose.recordedAt).toBe('2026-07-08T14:30:00.000Z');
  });

  it('rejects an unparseable recorded_at', () => {
    expect(() =>
      repo.validateVitalWrite({ ...base, metricKey: 'steps', value: 1, recordedAt: 'yesterday' }),
    ).toThrow(/recorded_at/);
  });

  // I2 — abuse bounds on client-controlled string/JSON sizes.
  describe('size limits (I2)', () => {
    it('rejects source longer than 64 chars; exactly 64 passes', () => {
      expect(() =>
        repo.validateVitalWrite({
          ...base,
          metricKey: 'steps',
          value: 1,
          source: 'x'.repeat(65),
        }),
      ).toThrow(/source[\s\S]*64/);
      const ok = repo.validateVitalWrite({
        ...base,
        metricKey: 'steps',
        value: 1,
        source: 'x'.repeat(64),
      });
      expect(ok.source).toHaveLength(64);
    });

    it('caps metric_key at 64 chars so error messages cannot echo huge strings', () => {
      const huge = 'k'.repeat(100_000);
      let message = '';
      try {
        repo.validateVitalWrite({ ...base, metricKey: huge, value: 1 });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/metric_key[\s\S]*64/);
      expect(message).not.toContain(huge);
      expect(message.length).toBeLessThan(500);
      // a 64-char unknown key still gets the registry error
      expect(() =>
        repo.validateVitalWrite({ ...base, metricKey: 'z'.repeat(64), value: 1 }),
      ).toThrow(/registry is closed/);
    });

    it('rejects metadata whose JSON serialization exceeds 4096 chars; exactly 4096 passes', () => {
      // {"pad":"<n chars>"} serializes to n + 10 chars.
      const atLimit = { pad: 'x'.repeat(4086) };
      const overLimit = { pad: 'x'.repeat(4087) };
      expect(JSON.stringify(atLimit)).toHaveLength(4096);

      expect(() =>
        repo.validateVitalWrite({ ...base, metricKey: 'steps', value: 1, metadata: overLimit }),
      ).toThrow(/metadata[\s\S]*4096/);
      const ok = repo.validateVitalWrite({
        ...base,
        metricKey: 'steps',
        value: 1,
        metadata: atLimit,
      });
      expect(ok.metadata).toEqual(atLimit);
    });
  });

  // M2 — recorded_at year bounds.
  describe('recorded_at year bounds (M2)', () => {
    it("rejects the far-future extended-year form '+099999-01-01'", () => {
      expect(() =>
        repo.validateVitalWrite({
          ...base,
          metricKey: 'steps',
          value: 1,
          recordedAt: '+099999-01-01',
        }),
      ).toThrow(/1900[\s\S]*2100/);
    });

    it('rejects years before 1900 and after 2100; boundary years pass', () => {
      expect(() =>
        repo.validateVitalWrite({ ...base, metricKey: 'steps', value: 1, recordedAt: '1899-12-31' }),
      ).toThrow(/1900[\s\S]*2100/);
      expect(() =>
        repo.validateVitalWrite({ ...base, metricKey: 'steps', value: 1, recordedAt: '2101-01-01' }),
      ).toThrow(/1900[\s\S]*2100/);
      expect(
        repo.validateVitalWrite({ ...base, metricKey: 'steps', value: 1, recordedAt: '1900-01-01' })
          .recordedAt,
      ).toBe('1900-01-01T00:00:00Z');
      expect(
        repo.validateVitalWrite({ ...base, metricKey: 'steps', value: 1, recordedAt: '2100-12-31' })
          .recordedAt,
      ).toBe('2100-12-31T00:00:00Z');
    });
  });
});

// ---------------------------------------------------------------------------
// upsertOwnVital — idempotent write keyed on (user, metric, recorded_at,
// source, dependent IS NULL)
// ---------------------------------------------------------------------------

describe('upsertOwnVital', () => {
  it('inserts, then updates on re-push of the same (metric, day, source) tuple', () => {
    const first = repo.upsertOwnVital(db, OWNER, {
      metricKey: 'steps',
      value: 3000,
      source: 'watch',
      recordedAt: '2026-07-08T06:00:00Z',
    });
    expect(first).toBe('inserted');

    // same day, different time-of-day + new value → same normalized tuple
    const second = repo.upsertOwnVital(db, OWNER, {
      metricKey: 'steps',
      value: 9500,
      source: 'watch',
      recordedAt: '2026-07-08T23:00:00Z',
    });
    expect(second).toBe('updated');

    const rows = ctx.sqlite
      .prepare("select value, recorded_at, user_id from vitals where metric_key = 'steps'")
      .all() as { value: number; recorded_at: string; user_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(9500);
    expect(rows[0].recorded_at).toBe('2026-07-08T00:00:00Z');
    expect(rows[0].user_id).toBe(OWNER);

    const found = repo.findOwnVital(db, OWNER, {
      metricKey: 'steps',
      recordedAt: '2026-07-08T00:00:00Z',
      source: 'watch',
    });
    expect(found?.value).toBe(9500);
  });

  it('a different source inserts a separate row', () => {
    repo.upsertOwnVital(db, OWNER, {
      metricKey: 'weight',
      value: 180,
      source: 'renpho',
      recordedAt: '2026-07-08',
    });
    const result = repo.upsertOwnVital(db, OWNER, {
      metricKey: 'weight',
      value: 181,
      source: 'manual',
      recordedAt: '2026-07-08',
    });
    expect(result).toBe('inserted');
    const count = ctx.sqlite
      .prepare("select count(*) as n from vitals where metric_key = 'weight'")
      .get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('keeps intraday metrics distinct per timestamp within a day', () => {
    repo.upsertOwnVital(db, OWNER, {
      metricKey: 'blood_glucose',
      value: 95,
      source: 'cgm',
      recordedAt: '2026-07-08T08:00:00Z',
    });
    const second = repo.upsertOwnVital(db, OWNER, {
      metricKey: 'blood_glucose',
      value: 140,
      source: 'cgm',
      recordedAt: '2026-07-08T13:00:00Z',
    });
    expect(second).toBe('inserted');
    const count = ctx.sqlite
      .prepare("select count(*) as n from vitals where metric_key = 'blood_glucose'")
      .get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('persists resolved ordinal labels through the upsert', () => {
    repo.upsertOwnVital(db, OWNER, {
      metricKey: 'resilience',
      valueLabel: 'solid',
      source: 'oura',
      recordedAt: '2026-07-08',
    });
    const row = ctx.sqlite
      .prepare("select value, metadata from vitals where metric_key = 'resilience'")
      .get() as { value: number; metadata: string };
    expect(row.value).toBe(3);
    expect(JSON.parse(row.metadata).label).toBe('solid');
  });

  it('scopes the upsert tuple by dependent_id when one is passed (I3)', () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    const record = {
      metricKey: 'weight',
      value: 180,
      source: 'manual',
      recordedAt: '2026-07-08',
    };
    expect(repo.upsertOwnVital(db, OWNER, record)).toBe('inserted');
    // Same tuple but dependent-scoped → separate row, not an update.
    expect(repo.upsertOwnVital(db, OWNER, { ...record, value: 60 }, depId)).toBe('inserted');
    // Re-push for the dependent → updates the dependent row only.
    expect(repo.upsertOwnVital(db, OWNER, { ...record, value: 61 }, depId)).toBe('updated');

    const rows = ctx.sqlite
      .prepare("select value, dependent_id from vitals where metric_key = 'weight' order by value")
      .all() as { value: number; dependent_id: string | null }[];
    expect(rows).toEqual([
      { value: 61, dependent_id: depId },
      { value: 180, dependent_id: null },
    ]);
  });

  it('rejects registry-unknown metrics without writing', () => {
    expect(() =>
      repo.upsertOwnVital(db, OWNER, {
        metricKey: 'nope',
        value: 1,
        source: 'x',
        recordedAt: '2026-07-08',
      }),
    ).toThrow(repo.VitalWriteError);
    const count = ctx.sqlite.prepare('select count(*) as n from vitals').get() as { n: number };
    expect(count.n).toBe(0);
  });
});
