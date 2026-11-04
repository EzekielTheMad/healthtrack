// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collapseNativeDay,
  nativeRecordDay,
  nativeSource,
  recordMetricValues,
} from './native-normalize';
import { nativeBatchSchema, type NativeRecord } from './native-schema';
const make = (type: string, value: number, unit: string, id = 'a'): NativeRecord => ({
  record_type: type,
  source_package: 'com.example.source',
  record_id: id,
  start_time: '2026-10-24T12:00:00Z',
  source_modified_at: '2026-10-24T13:00:00Z',
  data: { value, unit },
});
afterEach(() => vi.unstubAllEnvs());
describe('native canonical projections', () => {
  it.each([
    ['weight', 80, 'kg', 'weight', 176.4, 'lbs'],
    ['body_fat', 20, '%', 'body_fat_pct', 20, '%'],
    ['resting_heart_rate', 50, 'bpm', 'resting_hr', 50, 'bpm'],
    ['heart_rate_variability', 45, 'ms', 'hrv_rmssd', 45, 'ms'],
    ['oxygen_saturation', 97, '%', 'spo2', 97, '%'],
    ['respiratory_rate', 14, 'breaths/min', 'respiratory_rate', 14, 'breaths/min'],
    ['blood_glucose', 5, 'mmol/L', 'blood_glucose', 90.091, 'mg/dL'],
    ['body_temperature', 37, '°C', 'body_temp', 98.6, '°F'],
    ['basal_body_temperature', 36, '°C', 'basal_body_temp', 96.8, '°F'],
    ['vo2_max', 45, 'mL/kg/min', 'vo2_max', 45, 'mL/kg/min'],
    ['hydration', 1000, 'mL', 'water_intake', 33.8140227, 'oz'],
  ])('maps %s with explicit %s/%s units', (type, n, unit, key, value, canonical) => {
    const values = recordMetricValues(make(String(type), Number(n), String(unit)));
    expect(values).toHaveLength(1);
    expect(values[0].metricKey).toBe(key);
    expect(values[0].value).toBeCloseTo(Number(value), 4);
    expect(values[0].unit).toBe(canonical);
  });
  it('rejects missing/unknown units, nonfinite or negative values and incomplete BP pairs', () => {
    expect(recordMetricValues(make('weight', 80, 'stones'))).toEqual([]);
    expect(recordMetricValues(make('oxygen_saturation', 150, '%'))).toEqual([]);
    expect(recordMetricValues(make('weight', -80, 'kg'))).toEqual([]);
    expect(recordMetricValues(make('weight', Number.NaN, 'kg'))).toEqual([]);
    expect(
      recordMetricValues({
        ...make('blood_pressure', 0, 'mmHg'),
        data: { systolic: 120, unit: 'mmHg' },
      })
    ).toEqual([]);
  });
  it('uses independent source means/latest/sums and preserves recorded zeros', () => {
    expect(
      collapseNativeDay([
        make('resting_heart_rate', 50, 'bpm'),
        make('resting_heart_rate', 60, 'bpm', 'b'),
      ]).values[0].value
    ).toBe(55);
    expect(
      collapseNativeDay([
        make('weight', 80, 'kg'),
        { ...make('weight', 81, 'kg', 'b'), start_time: '2026-10-24T14:00:00Z' },
      ]).values[0].value
    ).toBeCloseTo(178.6, 1);
    expect(
      collapseNativeDay([make('hydration', 0, 'oz'), make('hydration', 10, 'oz', 'b')]).values[0]
        .value
    ).toBe(10);
  });
  it('resolves configured local calendar dates including DST', () => {
    vi.stubEnv('TZ', 'America/New_York');
    expect(
      nativeRecordDay({ ...make('weight', 80, 'kg'), start_time: '2026-11-01T03:30:00Z' })
    ).toBe('2026-10-31');
    expect(
      nativeRecordDay({ ...make('weight', 80, 'kg'), start_time: '2026-11-01T06:30:00Z' })
    ).toBe('2026-11-01');
    expect(
      nativeRecordDay({ ...make('weight', 80, 'kg'), start_time: '2026-03-08T07:30:00Z' })
    ).toBe('2026-03-08');
  });
  it('hashes long packages within source bounds and retains package distinctions', () => {
    expect(nativeSource('a'.repeat(255))).toHaveLength(46);
    expect(nativeSource('com.example')).not.toBe(nativeSource('com.example.free'));
  });
});
const sleep = (
  id: string,
  start = '2026-10-24T00:00:00Z',
  end = '2026-10-24T02:00:00Z',
  stages: unknown[] = [{ start_time: start, end_time: end, stage: 'light' }]
): NativeRecord => ({
  ...make('sleep', 0, 'hours', id),
  start_time: start,
  end_time: end,
  data: { stages },
});
describe('sleep coverage', () => {
  it('does not derive sleep duration from incomplete stages or invent a score', () => {
    const result = collapseNativeDay([
      sleep('a', undefined, undefined, [
        { start_time: '2026-10-24T00:00:00Z', end_time: '2026-10-24T01:00:00Z', stage: 'deep' },
      ]),
    ]);
    expect(result.values.map((v) => v.metricKey)).toEqual(['deep_sleep']);
    expect(result.values[0].value).toBe(60);
    expect(result.values[0].metadata.stage_coverage_complete).toBe(false);
  });
  it('unions overlapping sessions and retains a separate nap without double counting', () => {
    const result = collapseNativeDay([
      sleep('a'),
      sleep('b', '2026-10-24T01:00:00Z', '2026-10-24T03:00:00Z'),
      sleep('nap', '2026-10-24T14:00:00Z', '2026-10-24T15:00:00Z'),
    ]);
    expect(result.values.find((v) => v.metricKey === 'sleep_duration')?.value).toBe(4);
    expect(result.values.find((v) => v.metricKey === 'light_sleep')?.value).toBe(240);
  });
  it('rejects contradictory overlapping stages within one session', () => {
    expect(
      recordMetricValues(
        sleep('a', undefined, undefined, [
          { start_time: '2026-10-24T00:00:00Z', end_time: '2026-10-24T02:00:00Z', stage: 'deep' },
          { start_time: '2026-10-24T01:00:00Z', end_time: '2026-10-24T02:00:00Z', stage: 'rem' },
        ])
      )
    ).toEqual([]);
  });
  it('does not hide a newer unknown-stage session behind older complete coverage', () => {
    const unknown = {
      ...sleep('new', undefined, undefined, [
        { start_time: '2026-10-24T00:00:00Z', end_time: '2026-10-24T02:00:00Z', stage: 'unknown' },
      ]),
      source_modified_at: '2026-10-25T00:00:00Z',
    };
    expect(collapseNativeDay([sleep('old'), unknown]).values).toEqual([]);
  });
});
describe('native protocol boundaries', () => {
  const batch = {
    protocol_version: 2,
    device_generation: '6a9c7733-f832-43c1-8030-f396a9ef0783',
    sequence: 1,
    batch_id: 'af252a66-84bd-4a53-b8c0-6f4207822b44',
    read_at: '2026-10-24T00:00:00Z',
    app_version: 'test',
    events: [],
  };
  it('rejects scope injection, unsupported versions, zero sequences, impossible dates, and over500 records', () => {
    expect(nativeBatchSchema.safeParse({ ...batch, user_id: 'other' }).success).toBe(false);
    expect(nativeBatchSchema.safeParse({ ...batch, protocol_version: 1 }).success).toBe(false);
    expect(nativeBatchSchema.safeParse({ ...batch, sequence: 0 }).success).toBe(false);
    expect(
      nativeBatchSchema.safeParse({
        ...batch,
        events: [{ kind: 'daily_snapshot', date: '2026-02-30', values: {} }],
      }).success
    ).toBe(false);
    expect(
      nativeBatchSchema.safeParse({
        ...batch,
        events: Array.from({ length: 501 }, () => ({
          kind: 'upsert',
          record: make('weight', 80, 'kg'),
        })),
      }).success
    ).toBe(false);
    expect(
      nativeBatchSchema.safeParse({
        ...batch,
        events: [
          {
            kind: 'rescan_begin',
            scope: {
              scan_id: batch.batch_id,
              record_type: 'weight',
              source_packages: ['com.example'],
              start_time: '2026-10-24T00:00:00Z',
              end_time: '2026-10-25T00:00:00Z',
            },
            cursor_anchored: false,
            authorized: true,
          },
        ],
      }).success
    ).toBe(false);
  });
});
