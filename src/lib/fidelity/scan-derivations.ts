import type { ScanMeasurement } from './contracts';
import type { DerivedScanMeasurement } from './web-scan-contracts';

/** Inputs must be the normalized measurements of ONE report, never daily/source-selected values. */
export function deriveScanMeasurements(
  measurements: readonly ScanMeasurement[]
): DerivedScanMeasurement[] {
  const byKey = new Map(measurements.map((measurement) => [measurement.metric_key, measurement]));
  const formulas = [
    {
      metric_key: 'ecw_ratio',
      numerator: 'extracellular_water',
      denominator: 'total_body_water',
      unit: 'fraction',
      factor: 1,
    },
    {
      metric_key: 'body_fat_pct',
      numerator: 'body_fat_mass',
      denominator: 'weight',
      unit: '%',
      factor: 100,
    },
    {
      metric_key: 'body_water_pct',
      numerator: 'total_body_water',
      denominator: 'weight',
      unit: '%',
      factor: 100,
    },
  ] as const;
  return formulas.flatMap(({ metric_key, numerator, denominator, unit, factor }) => {
    const a = byKey.get(numerator);
    const b = byKey.get(denominator);
    // Normalization guarantees mass units; still check old/corrupt persisted inputs defensively.
    if (
      !a ||
      !b ||
      a.unit !== 'lbs' ||
      b.unit !== 'lbs' ||
      !Number.isFinite(a.value) ||
      !Number.isFinite(b.value) ||
      a.value < 0 ||
      b.value <= 0 ||
      a.value > b.value
    )
      return [];
    const value = (a.value / b.value) * factor;
    if (!Number.isFinite(value)) return [];
    return [
      {
        metric_key,
        value,
        unit,
        basis: 'derived' as const,
        formula: `${numerator} / ${denominator}${factor === 100 ? ' × 100' : ''}`,
        input_metric_keys: [numerator, denominator],
      },
    ];
  });
}
