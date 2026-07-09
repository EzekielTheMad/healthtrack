import { describe, it, expect } from 'vitest';
import { getVitalRange, FALLBACK_RANGE_KEYS } from '@/lib/reference-ranges';
import { getMetric } from '@/lib/metrics/registry';

describe('getVitalRange', () => {
  it('returns RHR range for adult male', () => {
    const range = getVitalRange('resting_hr', 30, 'male');
    expect(range).not.toBeNull();
    expect(range!.low).toBeGreaterThan(0);
    expect(range!.high).toBeGreaterThan(range!.low);
    expect(range!.unit).toBe('bpm');
  });

  it('returns RHR range for adult female', () => {
    const range = getVitalRange('resting_hr', 30, 'female');
    expect(range).not.toBeNull();
    expect(range!.unit).toBe('bpm');
  });

  it('returns SpO2 range (universal)', () => {
    const range = getVitalRange('spo2', 40, 'male');
    expect(range).not.toBeNull();
    expect(range!.low).toBe(95);
    expect(range!.high).toBe(100);
    expect(range!.unit).toBe('%');
  });

  it('returns AHI range', () => {
    const range = getVitalRange('ahi', 50, 'male');
    expect(range).not.toBeNull();
    expect(range!.low).toBe(0);
    expect(range!.high).toBe(4.9);
  });

  it('returns sleep duration range', () => {
    const range = getVitalRange('sleep_duration', 35, 'female');
    expect(range).not.toBeNull();
    expect(range!.low).toBe(7);
    expect(range!.high).toBe(9);
    expect(range!.unit).toBe('hours');
  });

  it('returns null for unknown metric', () => {
    const range = getVitalRange('unknown_metric', 30, 'male');
    expect(range).toBeNull();
  });

  it('returns HRV range', () => {
    const range = getVitalRange('hrv_rmssd', 25, 'male');
    expect(range).not.toBeNull();
    expect(range!.unit).toBe('ms');
  });

  it('returns body temperature range', () => {
    const range = getVitalRange('body_temp', 30, 'male');
    expect(range).not.toBeNull();
    expect(range!.low).toBe(96.0);
    expect(range!.high).toBe(99.0);
    expect(range!.unit).toBe('°F');
  });

  it('returns respiratory rate range', () => {
    const range = getVitalRange('respiratory_rate', 30, 'female');
    expect(range).not.toBeNull();
    expect(range!.low).toBe(12);
    expect(range!.high).toBe(20);
    expect(range!.unit).toBe('breaths/min');
  });

  it('every fallback range key exists in the metric registry', () => {
    for (const key of FALLBACK_RANGE_KEYS) {
      expect(getMetric(key), `fallback range key ${key} missing from registry`).toBeDefined();
    }
  });
});
