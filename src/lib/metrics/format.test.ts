/**
 * Shared metric display formatting: duration rendering for minute-based sleep
 * metrics, decimal clamping with thousands separators, and the compact
 * display-unit convention ('hours' → 'hrs').
 */
import { describe, it, expect } from 'vitest';
import { getMetric } from './registry';
import {
  formatDuration,
  formatMetricValue,
  isDurationMetric,
  displayUnit,
} from './format';

describe('formatDuration', () => {
  it('renders hours and minutes', () => {
    expect(formatDuration(462)).toBe('7h 42m');
  });
  it('renders minutes only under an hour', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(0)).toBe('0m');
  });
  it('renders whole hours without a minutes part', () => {
    expect(formatDuration(120)).toBe('2h');
  });
  it('rounds fractional minutes', () => {
    expect(formatDuration(89.6)).toBe('1h 30m');
  });
});

describe('formatMetricValue', () => {
  it('clamps to the given decimals, stripping trailing zeros', () => {
    expect(formatMetricValue(3.3333333333, 1)).toBe('3.3');
    expect(formatMetricValue(210.5, 1)).toBe('210.5');
    expect(formatMetricValue(58.0, 0)).toBe('58');
  });
  it('adds thousands separators for large values', () => {
    expect(formatMetricValue(12345.6, 0)).toBe('12,346');
    expect(formatMetricValue(3624, 0)).toBe('3,624');
  });
});

describe('isDurationMetric', () => {
  it('is true for minute-based sleep metrics', () => {
    for (const key of ['deep_sleep', 'light_sleep', 'rem_sleep', 'awake_time', 'time_in_bed', 'sleep_latency']) {
      expect(isDurationMetric(getMetric(key)), key).toBe(true);
    }
  });
  it('is false for non-sleep minute metrics and non-minute sleep metrics', () => {
    expect(isDurationMetric(getMetric('active_minutes'))).toBe(false);
    expect(isDurationMetric(getMetric('sleep_duration'))).toBe(false); // hours
    expect(isDurationMetric(getMetric('stress_high'))).toBe(false);
    expect(isDurationMetric(undefined)).toBe(false);
  });
});

describe('displayUnit', () => {
  it("compacts 'hours' to 'hrs' and passes other units through", () => {
    expect(displayUnit('hours')).toBe('hrs');
    expect(displayUnit('bpm')).toBe('bpm');
    expect(displayUnit(null)).toBe('');
  });
});
