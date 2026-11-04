import { FitnessWriteError } from '@/lib/repos/_fitness';
import type { ScanInput, ScanMeasurement } from '@/lib/fidelity/contracts';
import { getScanMetric } from './scan-registry';

/** Deliberately separate from legacy vitals conversion, which quantizes kg. */
export function normalizeScanMeasurements(scan: ScanInput): ScanMeasurement[] {
  return scan.measurements.map((measurement) => {
    const metric = getScanMetric(measurement.metric_key);
    if (!metric || !['body_composition', 'body_measurement'].includes(metric.category)) {
      throw new FitnessWriteError(
        `Unsupported scan metric '${measurement.metric_key}'. Keep unsupported outputs in the source report.`
      );
    }
    let value = measurement.value;
    const unit = measurement.unit;
    if (value < 0) throw new FitnessWriteError(`${metric.key} must not be negative.`);
    if (metric.unit === 'lbs') {
      if (unit === 'kg') value *= 2.2046226218487757;
      else if (unit !== 'lbs')
        throw new FitnessWriteError(`${metric.key} requires kg or lbs; water liters are not mass.`);
    } else if (metric.unit === 'in') {
      if (unit === 'cm') value /= 2.54;
      else if (unit !== 'in') throw new FitnessWriteError(`${metric.key} requires cm or in.`);
    } else if (metric.unit === 'fraction') {
      if (unit === '%') value /= 100;
      else if (unit !== 'fraction')
        throw new FitnessWriteError(`${metric.key} requires fraction or %.`);
      if (value > 1)
        throw new FitnessWriteError(`${metric.key} must be a fraction from 0 through 1.`);
    } else if (metric.unit === 'degrees') {
      if (!['degrees', 'degree', '°', 'deg'].includes(unit))
        throw new FitnessWriteError(`${metric.key} requires degrees, not radians.`);
    } else if (metric.unit === 'kg/m²') {
      if (!['kg/m²', 'kg/m2', 'kg/m^2'].includes(unit))
        throw new FitnessWriteError(
          `${metric.key} requires kg/m²; preserve its source definition.`
        );
    } else if (metric.key === 'visceral_fat_area') {
      if (unit !== 'cm²' && unit !== 'cm2')
        throw new FitnessWriteError('visceral_fat_area requires cm² or cm2.');
    } else if (metric.unit === '%') {
      if (unit !== '%' || value > 100)
        throw new FitnessWriteError(`${metric.key} requires a percentage from 0 through 100.`);
    } else if (metric.unit === null) {
      const accepted =
        metric.key === 'bmi' ? ['unitless', 'kg/m²', 'kg/m2'] : ['unitless', 'level', 'score'];
      if (!accepted.includes(unit))
        throw new FitnessWriteError(
          `${metric.key} requires an explicit unitless, level or score unit.`
        );
    } else if (unit !== metric.unit) {
      throw new FitnessWriteError(`${metric.key} requires ${metric.unit}.`);
    }
    if (!Number.isFinite(value))
      throw new FitnessWriteError(`${metric.key} conversion exceeds the supported numeric range.`);
    return {
      metric_key: metric.key,
      value,
      unit: metric.unit,
      source_value: measurement.value,
      source_unit: unit,
      ...(measurement.raw_text !== undefined ? { raw_text: measurement.raw_text } : {}),
      ...(measurement.definition !== undefined ? { definition: measurement.definition } : {}),
      estimated:
        scan.method === 'bia' ||
        (metric.category === 'body_composition' && metric.key !== 'weight') ||
        (metric.category === 'body_measurement' && scan.method !== 'tape'),
    };
  });
}
