import { expect, it } from 'vitest';
import { deriveScanMeasurements } from './scan-derivations';
import type { ScanMeasurement } from './contracts';
const mass = (metric_key: string, value: number, unit = 'lbs'): ScanMeasurement => ({
  metric_key,
  value,
  unit,
  source_value: value,
  source_unit: unit,
  estimated: true,
});
it('derives only same-scan mass ratios and retains separate reported ratios', () => {
  const rows = [
    mass('weight', 100),
    mass('body_fat_mass', 20),
    mass('total_body_water', 50),
    mass('extracellular_water', 20),
    mass('ecw_ratio', 0.39, 'fraction'),
  ];
  expect(deriveScanMeasurements(rows)).toEqual([
    {
      metric_key: 'ecw_ratio',
      value: 0.4,
      unit: 'fraction',
      basis: 'derived',
      formula: 'extracellular_water / total_body_water',
      input_metric_keys: ['extracellular_water', 'total_body_water'],
    },
    {
      metric_key: 'body_fat_pct',
      value: 20,
      unit: '%',
      basis: 'derived',
      formula: 'body_fat_mass / weight × 100',
      input_metric_keys: ['body_fat_mass', 'weight'],
    },
    {
      metric_key: 'body_water_pct',
      value: 50,
      unit: '%',
      basis: 'derived',
      formula: 'total_body_water / weight × 100',
      input_metric_keys: ['total_body_water', 'weight'],
    },
  ]);
  expect(rows[4].value).toBe(0.39);
});
it('keeps missing inputs unknown, genuine numerator zero valid, invalid denominators unavailable', () => {
  expect(deriveScanMeasurements([mass('body_fat_mass', 0)])).toEqual([]);
  expect(deriveScanMeasurements([mass('weight', 100), mass('body_fat_mass', 0)])[0].value).toBe(0);
  for (const denominator of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    expect(deriveScanMeasurements([mass('weight', denominator), mass('body_fat_mass', 0)])).toEqual(
      []
    );
  expect(deriveScanMeasurements([mass('weight', 10), mass('body_fat_mass', 11)])).toEqual([]);
  expect(
    deriveScanMeasurements([mass('total_body_water', 10, 'L'), mass('extracellular_water', 2)])
  ).toEqual([]);
});
it('never derives skeletal muscle or SMI from regional lean, soft lean or height', () => {
  expect(
    deriveScanMeasurements([
      mass('lean_mass_left_arm', 2),
      mass('lean_mass_right_arm', 2),
      mass('soft_lean_mass', 50),
      mass('height', 1.8, 'm'),
    ])
  ).toEqual([]);
});
