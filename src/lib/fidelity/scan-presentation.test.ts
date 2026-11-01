import { expect, it } from 'vitest';
import { scanMetricDelta, scanComparisonWarnings } from './scan-presentation';
import type { BodyScan } from './contracts';
function scan(id: string, value: number): BodyScan {
  return {
    id,
    user_id: 'owner',
    dependent_id: null,
    revision: 'r',
    received_at: '2026-11-01T00:00:00Z',
    scan: {
      external_id: id,
      source: 'Fictional BIA',
      manufacturer: 'Fictional',
      model: 'one',
      method: 'bia',
      measured_at: { precision: 'day', value: '2026-10-30' },
      conditions: { workout_status: 'pre_workout', fasting_status: 'fasted' },
      provenance: { basis: 'source_reported', verification: 'unconfirmed', sources: [] },
      measurements: [{ metric_key: 'body_fat_mass', value, unit: 'lbs' }],
    },
    measurements: [
      {
        metric_key: 'body_fat_mass',
        value,
        unit: 'lbs',
        source_value: value,
        source_unit: 'lbs',
        estimated: true,
      },
    ],
  };
}
it('compares only matching source/device/method and known collection conditions', () => {
  const before = scan('before', 20);
  const after = scan('after', 21);
  expect(scanMetricDelta(after, before, 'body_fat_mass')).toBe(1);
  for (const changed of [
    { ...after, scan: { ...after.scan, model: 'different' } },
    {
      ...after,
      scan: {
        ...after.scan,
        conditions: { workout_status: 'unknown' as const, fasting_status: 'fasted' as const },
      },
    },
    {
      ...after,
      scan: {
        ...after.scan,
        conditions: { workout_status: 'post_workout' as const, fasting_status: 'fasted' as const },
      },
    },
  ]) {
    expect(scanMetricDelta(changed, before, 'body_fat_mass')).toBeNull();
    expect(scanComparisonWarnings(changed, before).length).toBeGreaterThan(0);
  }
});
