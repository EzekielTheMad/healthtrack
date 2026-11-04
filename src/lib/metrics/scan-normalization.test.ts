import { expect, it } from 'vitest';
import { scanInputSchema, type ScanInput } from '@/lib/fidelity/contracts';
import { WEB_SCAN_METRICS } from '@/lib/fidelity/web-scan-contracts';
import { getMetric } from './registry';
import { getScanMetric } from './scan-registry';
import { normalizeScanMeasurements } from './scan-normalization';

function input(measurements: ScanInput['measurements']): ScanInput {
  return scanInputSchema.parse({
    external_id: 'test',
    source: 'Fictional report',
    method: 'bia',
    measured_at: { precision: 'unknown', value: null },
    provenance: { basis: 'source_reported', sources: [] },
    measurements,
  });
}
it('adds all 24 report-only metrics without granting them to ordinary vitals', () => {
  expect(WEB_SCAN_METRICS).toHaveLength(24);
  for (const metric_key of WEB_SCAN_METRICS) {
    expect(getMetric(metric_key)).toBeUndefined();
    expect(getScanMetric(metric_key)).toBeDefined();
    const unit = getScanMetric(metric_key)!.unit!;
    const row = normalizeScanMeasurements(input([{ metric_key, value: 0, unit }]))[0];
    expect(row).toMatchObject({ metric_key, value: 0, source_value: 0, source_unit: unit });
  }
});
it('preserves source values, definitions and actual units while converting without quantization', () => {
  const rows = normalizeScanMeasurements(
    input([
      {
        metric_key: 'lean_mass_left_arm',
        value: 2.123456789,
        unit: 'kg',
        definition: 'Vendor lean soft tissue',
        raw_text: '2.123456789 kg',
      },
      { metric_key: 'phase_angle', value: 6.42, unit: '°', definition: 'Right side, 50 kHz' },
      {
        metric_key: 'skeletal_muscle_index',
        value: 7.1,
        unit: 'kg/m^2',
        definition: 'Appendicular lean mass / height²',
      },
      { metric_key: 'ecw_ratio_trunk', value: 38, unit: '%', definition: 'Trunk ECW/TBW' },
    ])
  );
  expect(rows[0]).toMatchObject({
    value: 2.123456789 * 2.2046226218487757,
    source_value: 2.123456789,
    source_unit: 'kg',
    definition: 'Vendor lean soft tissue',
    raw_text: '2.123456789 kg',
  });
  expect(rows[1]).toMatchObject({ value: 6.42, unit: 'degrees', source_unit: '°' });
  expect(rows[2]).toMatchObject({ value: 7.1, unit: 'kg/m²', source_unit: 'kg/m^2' });
  expect(rows[3]).toMatchObject({ value: 0.38, unit: 'fraction', source_unit: '%' });
});
it('rejects unsupported units and impossible fractions rather than guessing definitions', () => {
  for (const row of [
    { metric_key: 'phase_angle', value: 1, unit: 'radians' },
    { metric_key: 'skeletal_muscle_index', value: 7, unit: 'lbs' },
    { metric_key: 'ecw_ratio_left_leg', value: 101, unit: '%' },
    { metric_key: 'protein_mass', value: 3, unit: 'L' },
    { metric_key: 'total_body_water', value: 3, unit: 'L' },
  ])
    expect(() => normalizeScanMeasurements(input([row]))).toThrow();
});
