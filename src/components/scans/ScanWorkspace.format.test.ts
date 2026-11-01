import { expect, it } from 'vitest';
import { formatScanComparisonValue, scanMeasurementLabel } from './ScanWorkspace';

it('limits comparison noise and marks display rounding explicitly', () => {
  expect(formatScanComparisonValue(68.7842258016818)).toBe('≈ 68.7842');
  expect(formatScanComparisonValue(31.2)).toBe('31.2');
  expect(formatScanComparisonValue(0)).toBe('0');
  expect(formatScanComparisonValue(-0)).toBe('0');
  expect(formatScanComparisonValue(0.123456789, true)).toBe('≈ +0.123457');
  expect(formatScanComparisonValue(-0.123456789, true)).toBe('≈ -0.123457');
  expect(formatScanComparisonValue(1.25, true)).toBe('+1.25');
  expect(formatScanComparisonValue(0, true)).toBe('0');
});
it('never displays a tiny nonzero comparison as zero', () => {
  expect(formatScanComparisonValue(1.23456789e-10)).toBe('≈ 1.23457e-10');
  expect(formatScanComparisonValue(-1.23456789e-10)).toBe('≈ -1.23457e-10');
  expect(formatScanComparisonValue(Number.MIN_VALUE)).toBe('5e-324');
  expect(formatScanComparisonValue(-Number.MIN_VALUE)).toBe('-5e-324');
});
it('does not disguise unavailable comparison values as recorded zero', () => {
  expect(formatScanComparisonValue(Number.NaN)).toBe('Unavailable');
  expect(formatScanComparisonValue(Number.POSITIVE_INFINITY)).toBe('Unavailable');
});
it('shows one estimate marker whether supplied by the registry or scan provenance', () => {
  expect(scanMeasurementLabel('skeletal_muscle_mass', true)).toBe(
    'Skeletal Muscle Mass (estimate)'
  );
  expect(scanMeasurementLabel('visceral_fat_area', true)).toBe('Visceral Fat Area (estimate)');
  expect(scanMeasurementLabel('weight', true)).toBe('Weight · estimate');
  expect(scanMeasurementLabel('weight', false)).toBe('Weight');
});
