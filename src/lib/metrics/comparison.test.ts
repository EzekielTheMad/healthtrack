// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  insertDelegate,
  insertShare,
  OWNER,
  VIEWER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import type { VitalRow } from '@/lib/repos/vitals';
import type { NutritionDailyRow } from '@/lib/repos/nutrition';
import type { WorkoutWithEntries } from '@/lib/repos/workouts';
import type { ComparisonMetric } from './comparison-types';

let ctx: RepoTestDb;
const dependentId = 'comparison-dependent';
const now = new Date('2026-10-24T05:00:00Z');
const own = { ownerId: OWNER, dependentId: null };

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-comparison-');
  for (const id of [OWNER, VIEWER, STRANGER]) insertUser(ctx.sqlite, id);
  insertDependent(ctx.sqlite, dependentId, OWNER);
  vi.stubEnv('TZ', 'America/Phoenix');
});
afterEach(() => {
  ctx.restore();
  vi.unstubAllEnvs();
});

function metric(metrics: ComparisonMetric[], key: string) {
  return metrics.find((m) => m.key === key)!;
}
function value(m: ComparisonMetric, source: string, date = '2026-10-23') {
  return m.sources.find((s) => s.source === source)!.points.find((p) => p.date === date)!.value;
}
function vital(
  key: string,
  n: number,
  at: string,
  source = 'manual',
  unit: string | null = null
): VitalRow {
  return {
    id: `${key}-${at}-${source}`,
    userId: OWNER,
    dependentId: null,
    metricKey: key,
    value: n,
    recordedAt: at,
    source,
    unit,
    metadata: {},
    createdAt: at,
    lastReceivedAt: null,
    nativeRecordId: null,
  };
}

describe('single-person comparison service', () => {
  it('labels native packages without changing source identities or preferences', async () => {
    const { comparisonMetrics } = await import('./comparison');
    const source = 'hc:oXVka5w7YY-FL02zOl40n0VlJa6EoQFoRj6bZIpcjh0';
    const reading = { ...vital('weight', 180, '2026-10-23T00:00:00Z', source, 'lbs'), metadata: { health_connect: true, source_package: 'com.example.scale' } };
    const result = comparisonMetrics({ vitals: [reading], nutrition: [], workouts: [], preferences: { weight: source } }, ['2026-10-23'], 'America/Phoenix');
    expect(metric(result.metrics, 'vital:weight')).toMatchObject({ selected_source: source, sources: [{ source, label: 'Health Connect · com.example.scale' }] });
  });
  it('aligns 30/90 calendar days in the configured timezone without borrowing another patient', async () => {
    const { createVital } = await import('@/lib/repos/vitals');
    for (const [scope, n] of [
      [own, 0],
      [{ ownerId: OWNER, dependentId }, 999],
    ] as const) {
      await createVital(OWNER, scope, {
        metricKey: 'ahi',
        value: n,
        recordedAt: '2026-10-23',
        source: 'myair',
      });
    }
    const { buildMetricComparison } = await import('./comparison');
    const result = await buildMetricComparison(OWNER, own, 30, now);
    expect(result).toMatchObject({
      start_date: '2026-09-24',
      end_date: '2026-10-23',
      time_zone: 'America/Phoenix',
      unavailable_domains: [],
    });
    const m = metric(result.metrics, 'vital:ahi');
    expect(m.sources[0].points).toHaveLength(30);
    expect(value(m, 'myair')).toBe(0);
    expect(m.sources[0].recorded_days).toBe(1);
    expect(value(m, 'myair', '2026-10-22')).toBeNull();
    const child = await buildMetricComparison(OWNER, { ownerId: OWNER, dependentId }, 90, now);
    expect(child.unavailable_domains).toEqual(['nutrition', 'fitness']);
    expect(child.start_date).toBe('2026-07-26');
    expect(value(metric(child.metrics, 'vital:ahi'), 'myair')).toBe(999);
    await expect(buildMetricComparison(STRANGER, own, 30, now)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      buildMetricComparison(OWNER, { ownerId: OWNER, dependentId: 'not-owned' }, 30, now)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('keeps delegates on the selected owner and omits both users owner-only domains and preferences', async () => {
    const { createVital, setVitalSourcePreference } = await import('@/lib/repos/vitals');
    await createVital(OWNER, own, {
      metricKey: 'weight',
      value: 100,
      source: 'renpho',
      recordedAt: '2026-10-23',
    });
    await createVital(
      OWNER,
      { ownerId: OWNER, dependentId },
      { metricKey: 'weight', value: 999, source: 'renpho', recordedAt: '2026-10-23' }
    );
    await createVital(
      VIEWER,
      { ownerId: VIEWER, dependentId: null },
      { metricKey: 'weight', value: 666, source: 'renpho', recordedAt: '2026-10-23' }
    );
    await setVitalSourcePreference(VIEWER, 'weight', 'manual');
    const { overwriteNutritionDay } = await import('@/lib/repos/nutrition');
    const { db } = await import('@/db');
    for (const id of [OWNER, VIEWER])
      overwriteNutritionDay(db, id, {
        date: '2026-10-23',
        sourcePackage: 'com.sbs.diet',
        calories: 2000,
        proteinGrams: 100,
        carbsGrams: 100,
        fatGrams: 100,
        recordCount: 1,
      });
    const { buildMetricComparison } = await import('./comparison');
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['vitals'],
      dependentId,
    });
    await expect(
      buildMetricComparison(VIEWER, { ownerId: OWNER, dependentId: 'all' }, 30, now)
    ).rejects.toMatchObject({ status: 404 });
    insertDelegate(ctx.sqlite, { ownerId: OWNER, delegateUserId: VIEWER });
    const result = await buildMetricComparison(
      VIEWER,
      { ownerId: OWNER, dependentId: 'all' },
      30,
      now
    );
    expect(result.metrics.map((m) => m.key)).toEqual(['vital:weight']);
    expect(value(metric(result.metrics, 'vital:weight'), 'renpho')).toBe(100);
    expect(metric(result.metrics, 'vital:weight').selected_source).toBe('renpho');
    expect(result.unavailable_domains).toEqual(['nutrition', 'fitness']);
    expect(result.warnings.join(' ')).toContain('dependent records are excluded');
  });

  it('filters the selected delegate owner before limiting rows, without granting health-share access', async () => {
    const { createVital } = await import('@/lib/repos/vitals');
    await createVital(OWNER, own, {
      metricKey: 'blood_glucose',
      value: 101,
      unit: 'mg/dL',
      recordedAt: '2026-10-22T12:00:00Z',
      source: 'manual',
    });
    const stmt = ctx.sqlite.prepare(
      'INSERT INTO vitals(id,user_id,dependent_id,metric_key,value,unit,source,recorded_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
    );
    ctx.sqlite.transaction(() => {
      for (let i = 0; i < 20001; i++)
        stmt.run(
          `dependent-flood-${i}`,
          OWNER,
          dependentId,
          'blood_glucose',
          999,
          'mg/dL',
          'manual',
          new Date(Date.parse('2026-10-23T12:00:00Z') + i).toISOString(),
          '2026-10-23T12:00:00Z'
        );
    })();
    const { buildMetricComparison } = await import('./comparison');
    // Even a share for the exact owner's own record must not become the
    // broader delegate-mode grant merely because the SQL scope is narrowed.
    insertShare(ctx.sqlite, { ownerId: OWNER, sharedWithId: VIEWER, sections: ['vitals'] });
    const delegateScope = { ownerId: OWNER, dependentId: 'all' };
    await expect(buildMetricComparison(VIEWER, delegateScope, 30, now)).rejects.toMatchObject({
      status: 404,
    });
    insertDelegate(ctx.sqlite, { ownerId: OWNER, delegateUserId: VIEWER });
    const result = await buildMetricComparison(VIEWER, delegateScope, 30, now);
    expect(value(metric(result.metrics, 'vital:blood_glucose'), 'manual', '2026-10-22')).toBe(101);
    expect(metric(result.metrics, 'vital:blood_glucose').sources[0].recorded_days).toBe(1);
    expect(result.warnings.join(' ')).not.toContain('20000-row limit');
  });

  it('applies shared source selection and honors a preferred device with no readings', async () => {
    const { createVital, setVitalSourcePreference } = await import('@/lib/repos/vitals');
    for (const source of ['oura', 'health_connect_daily']) {
      await createVital(OWNER, own, {
        metricKey: 'steps',
        value: 100,
        source,
        recordedAt: '2026-10-23',
      });
      await createVital(OWNER, own, {
        metricKey: 'sleep_score',
        value: 80,
        source,
        recordedAt: '2026-10-23',
      });
    }
    const { buildMetricComparison } = await import('./comparison');
    const first = await buildMetricComparison(OWNER, own, 30, now);
    expect(metric(first.metrics, 'vital:steps').selected_source).toBe('health_connect_daily');
    expect(metric(first.metrics, 'vital:sleep_score').selected_source).toBeNull();
    await setVitalSourcePreference(OWNER, 'steps', 'unavailable_device');
    const second = await buildMetricComparison(OWNER, own, 30, now);
    const steps = metric(second.metrics, 'vital:steps');
    expect(steps.selected_source).toBe('unavailable_device');
    expect(steps.sources.find((s) => s.source === 'unavailable_device')).toMatchObject({
      recorded_days: 0,
    });
    expect(
      steps.sources
        .find((s) => s.source === 'unavailable_device')!
        .points.every((p) => p.value === null)
    ).toBe(true);
  });

  it('reports a bounded vital result without claiming full coverage', async () => {
    const stmt = ctx.sqlite.prepare(
      'INSERT INTO vitals(id,user_id,metric_key,value,unit,source,recorded_at,created_at) VALUES(?,?,?,?,?,?,?,?)'
    );
    ctx.sqlite.transaction(() => {
      for (let i = 0; i < 20001; i++)
        stmt.run(
          `bounded-${i}`,
          OWNER,
          'blood_glucose',
          100,
          'mg/dL',
          'manual',
          new Date(Date.parse('2026-10-23T12:00:00Z') + i).toISOString(),
          '2026-10-23T12:00:00Z'
        );
    })();
    const { buildMetricComparison } = await import('./comparison');
    const result = await buildMetricComparison(OWNER, own, 30, now);
    expect(result.warnings.join(' ')).toContain('20000-row limit');
    expect(metric(result.metrics, 'vital:blood_glucose').sources).toHaveLength(1);
  }, 15000); // Real 20,001-row fixture and indexed writes can exceed 5s during concurrent builds.
});

describe('daily comparison semantics', () => {
  it('retains an explicit preferred source even when the entire metric window is empty', async () => {
    const { comparisonMetrics } = await import('./comparison');
    const result = comparisonMetrics(
      { vitals: [], nutrition: [], workouts: [], preferences: { ahi: 'myair' } },
      ['2026-10-22', '2026-10-23'],
      'America/Phoenix'
    );
    expect(metric(result.metrics, 'vital:ahi')).toMatchObject({
      selected_source: 'myair',
      sources: [
        {
          source: 'myair',
          recorded_days: 0,
          points: [
            { date: '2026-10-22', value: null },
            { date: '2026-10-23', value: null },
          ],
        },
      ],
    });
  });
  it('uses local calendar days for intraday means, preserves normalized dates and true zeros', async () => {
    const { comparisonMetrics } = await import('./comparison');
    const result = comparisonMetrics(
      {
        vitals: [
          vital('blood_glucose', 100, '2026-10-24T05:00:00Z', 'manual', 'mg/dL'),
          vital('blood_glucose', 120, '2026-10-23T12:00:00Z', 'manual', 'mg/dL'),
          vital('blood_glucose', 999, '2026-10-24T08:00:00Z', 'manual', 'mg/dL'),
          vital('ahi', 0, '2026-10-23T00:00:00Z', 'myair', 'events/hr'),
        ],
        nutrition: [],
        workouts: [],
      },
      ['2026-10-22', '2026-10-23'],
      'America/Phoenix'
    );
    expect(value(metric(result.metrics, 'vital:blood_glucose'), 'manual')).toBe(110);
    expect(value(metric(result.metrics, 'vital:ahi'), 'myair')).toBe(0);
    expect(value(metric(result.metrics, 'vital:ahi'), 'myair', '2026-10-22')).toBeNull();
  });

  it('uses latest daily device totals, canonical unit conversions, and gaps for unsupported units', async () => {
    const { comparisonMetrics } = await import('./comparison');
    const result = comparisonMetrics(
      {
        vitals: [
          vital('steps', 300, '2026-10-23T00:00:00Z', 'oura', 'steps'),
          vital('steps', 400, '2026-10-23T12:00:00Z', 'oura', 'steps'),
          vital('weight', 100, '2026-10-23T00:00:00Z', 'renpho', 'kg'),
          vital('weight', 999, '2026-10-22T00:00:00Z', 'renpho', 'stone'),
          vital('sleep_score', 80, '2026-10-23T00:00:00Z', '__proto__'),
        ],
        nutrition: [],
        workouts: [],
      },
      ['2026-10-22', '2026-10-23'],
      'America/Phoenix'
    );
    expect(value(metric(result.metrics, 'vital:steps'), 'oura')).toBe(400);
    expect(metric(result.metrics, 'vital:steps').aggregation).toBe('latest');
    expect(value(metric(result.metrics, 'vital:weight'), 'renpho')).toBeCloseTo(220.5);
    expect(value(metric(result.metrics, 'vital:weight'), 'renpho', '2026-10-22')).toBeNull();
    expect(result.warnings.join(' ')).toContain('unsupported units');
    expect(metric(result.metrics, 'vital:sleep_score').sources[0].label).toBe('__proto__');
  });

  it('keeps competing nutrition snapshots separate, including zero and unknown nutrients', async () => {
    const { comparisonMetrics } = await import('./comparison');
    const nutrition = ['com.sbs.diet', 'com.myfitnesspal.android'].map((sourcePackage, i) => ({
      sourcePackage,
      date: '2026-10-23',
      calories: i * 2000,
      proteinGrams: null,
      carbsGrams: 0,
      fatGrams: 20,
      updatedAt: '2026-10-24T00:00:00Z',
    })) as NutritionDailyRow[];
    const result = comparisonMetrics(
      { vitals: [], nutrition, workouts: [] },
      ['2026-10-22', '2026-10-23'],
      'America/Phoenix'
    );
    const calories = metric(result.metrics, 'nutrition:calories');
    expect(calories.selected_source).toBeNull();
    expect(value(calories, 'com.sbs.diet')).toBe(0);
    expect(value(calories, 'com.myfitnesspal.android')).toBe(2000);
    expect(value(calories, 'com.sbs.diet', '2026-10-22')).toBeNull();
    expect(result.metrics.some((m) => m.key === 'nutrition:protein')).toBe(false);
    expect(result.warnings.join(' ')).toContain('never added together');
  });

  it('sums logged sessions using canonical fitness tonnage, omitting unknown volume and duration', async () => {
    const { comparisonMetrics } = await import('./comparison');
    const workouts = [
      {
        startedAt: '2026-10-24T05:00:00Z',
        durationMin: 20,
        entries: [
          {
            sets: [
              { weight: 50, reps: 10, perSide: true },
              { weight: 999, reps: 10, warmup: true },
            ],
          },
        ],
      },
      {
        startedAt: '2026-10-23T12:00:00Z',
        durationMin: 30,
        entries: [{ sets: [{ weight: 50, reps: 10 }] }],
      },
      {
        startedAt: '2026-10-22T12:00:00Z',
        durationMin: null,
        entries: [{ sets: [{ seconds: 30 }] }],
      },
    ] as WorkoutWithEntries[];
    const result = comparisonMetrics(
      { vitals: [], nutrition: [], workouts },
      ['2026-10-22', '2026-10-23'],
      'America/Phoenix'
    );
    expect(value(metric(result.metrics, 'fitness:duration_min'), 'workout_log')).toBe(50);
    expect(value(metric(result.metrics, 'fitness:volume_lbs'), 'workout_log')).toBe(1500);
    expect(
      value(metric(result.metrics, 'fitness:volume_lbs'), 'workout_log', '2026-10-22')
    ).toBeNull();
    expect(
      value(metric(result.metrics, 'fitness:duration_min'), 'workout_log', '2026-10-22')
    ).toBeNull();
  });
});
