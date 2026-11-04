import { describe, expect, it } from 'vitest';
import type { ComparisonMetric, ComparisonSource } from '@/lib/metrics/comparison-types';
import {
  comparisonPoints,
  comparisonSource,
  comparisonValue,
  defaultComparison,
} from './comparison-view';

const source = (name: string): ComparisonSource => ({
  source: name,
  label: name,
  recorded_days: 2,
  points: [
    { date: '2026-10-01', value: 0 },
    { date: '2026-10-03', value: 3 },
  ],
});
const metric = (key: string): ComparisonMetric => ({
  key,
  label: key,
  unit: null,
  domain: 'vitals',
  aggregation: 'mean',
  selected_source: null,
  sources: [source('oura'), source('manual')],
});

describe('comparison view helpers', () => {
  it('emits all calendar dates with explicit gaps and preserves a recorded zero', () => {
    const points = comparisonPoints(
      { start_date: '2026-10-01', days: 30 },
      source('oura'),
      undefined
    );
    expect(points).toHaveLength(30);
    expect(points[0]).toEqual({ date: '2026-10-01', left: 0, right: null });
    expect(points[1]).toEqual({ date: '2026-10-02', left: null, right: null });
    expect(points[2]).toEqual({ date: '2026-10-03', left: 3, right: null });
    expect(points.at(-1)?.date).toBe('2026-10-30');
  });

  it('keeps source ambiguity unresolved until a visible source is chosen', () => {
    const ambiguous = metric('vital:weight');
    expect(comparisonSource(ambiguous, null)).toBeUndefined();
    expect(comparisonSource(ambiguous, 'oura')?.source).toBe('oura');
    expect(comparisonSource({ ...ambiguous, selected_source: 'manual' }, null)?.source).toBe(
      'manual'
    );
    expect(comparisonSource(ambiguous, 'no-longer-available')).toBeUndefined();
  });

  it('prefers the AHI and sleep preset only when both have recorded data', () => {
    expect(
      defaultComparison([metric('vital:weight'), metric('vital:sleep_score'), metric('vital:ahi')])
    ).toEqual(['vital:ahi', 'vital:sleep_score']);
    expect(defaultComparison([])).toEqual(['', '']);
  });

  it('makes missing, zero, decimal values and units distinct', () => {
    expect(comparisonValue(null, 'events/hr')).toBe('No data');
    expect(comparisonValue(0, 'events/hr')).toBe('0 events/hr');
    expect(comparisonValue(212.25, 'lbs')).toBe('212.25 lbs');
  });
});
