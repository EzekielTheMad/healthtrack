import { expect, it } from 'vitest';
import {
  scanMetricDelta,
  scanComparisonWarnings,
  scanMetricComparisonWarnings,
  scanEvidenceRows,
} from './scan-presentation';
import type { BodyScan } from './contracts';
import { selectCoherentScan } from './scan-selection';
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
it('retains conflicting scans as history but excludes them from deltas and coherent latest selection', () => {
  const before = scan('before', 20),
    conflict = scan('conflict', 21);
  conflict.scan.measured_at = { precision: 'day', value: '2026-10-31' };
  conflict.scan.provenance.verification = 'conflict';
  expect(scanMetricDelta(conflict, before, 'body_fat_mass')).toBeNull();
  expect(scanComparisonWarnings(conflict, before).join(' ')).toContain('conflicting');
  const selected = selectCoherentScan([conflict, before]);
  expect(selected.scan?.id).toBe('before');
  expect(selected.warnings.join(' ')).toContain('Conflicting');
  expect(selectCoherentScan([conflict]).scan).toBeNull();
  expect(conflict.scan.provenance.verification).toBe('conflict');
});
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
it('withholds definition/protocol mismatches and source-defined metrics with unknown definitions', () => {
  const before = scan('before', 20);
  const after = scan('after', 21);
  before.measurements[0].definition = 'Definition A';
  after.measurements[0].definition = 'Definition B';
  expect(scanMetricDelta(after, before, 'body_fat_mass')).toBeNull();
  expect(scanMetricComparisonWarnings(after, before, 'body_fat_mass').join(' ')).toContain(
    'definitions differ'
  );
  for (const metric_key of ['phase_angle', 'skeletal_muscle_index', 'ecw_ratio_trunk']) {
    before.measurements[0] = { ...before.measurements[0], metric_key, definition: undefined };
    after.measurements[0] = { ...after.measurements[0], metric_key, definition: undefined };
    expect(scanMetricDelta(after, before, metric_key)).toBeNull();
    before.measurements[0].definition = after.measurements[0].definition =
      'Exact same source protocol';
    expect(scanMetricDelta(after, before, metric_key)).toBe(1);
  }
});
it('presents exact source evidence, vendor zero/reference bounds and source-only recommendations', () => {
  const row = scan('vendor', 0);
  row.measurements[0].raw_text = '0.0000 lb';
  row.measurements[0].definition = 'Source fat mass';
  row.scan.vendor_results = {
    scores: [
      {
        key: 'score',
        name: 'Fictional score',
        value: 0,
        definition: 'Vendor-specific algorithm',
        reference: { low: 0, high: 100, unit: 'points' },
      },
    ],
    body_age: { value: 0, unit: 'years', definition: 'Proprietary estimate' },
    reference_bands: [
      {
        metric_key: 'body_fat_mass',
        label: 'Printed reference',
        reference: { high: 20, unit: 'kg', text: 'Source population only' },
      },
    ],
    recommendations: [{ name: 'Weight control', text: 'Printed change', value: 0, unit: 'kg' }],
  };
  const rows = scanEvidenceRows(row);
  expect(rows[0]).toMatchObject({
    value: '0',
    unit: 'lbs',
    raw_text: '0.0000 lb',
    definition: 'Source fat mass',
    basis: 'reported',
  });
  expect(rows.find((item) => item.key.startsWith('vendor:score:'))).toMatchObject({
    value: '0',
    definition: 'Vendor-specific algorithm',
    reference: 'Lower: 0 points; Upper: 100 points',
    source: 'Fictional BIA · Fictional · one · BIA',
  });
  expect(rows.find((item) => item.key === 'vendor:body_age')?.value).toBe('0');
  expect(rows.find((item) => item.key.startsWith('vendor:recommendation:'))).toMatchObject({
    value: 'Printed change · 0',
    label: expect.stringContaining('not an adopted target'),
  });
});
