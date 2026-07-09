import { describe, it, expect } from 'vitest';
import {
  METRICS,
  METRIC_MAP,
  getMetric,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type MetricCategory,
} from './registry';

const EXISTING_KEYS = [
  'hrv_rmssd',
  'resting_hr',
  'spo2',
  'ahi',
  'sleep_duration',
  'bp_systolic',
  'bp_diastolic',
  'body_temp',
  'respiratory_rate',
  'weight',
  'steps',
  'sleep_score',
];

describe('metric registry', () => {
  it('has unique keys', () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('contains at least 48 metrics', () => {
    expect(METRICS.length).toBeGreaterThanOrEqual(48);
  });

  it('keeps every pre-existing metric key spelled exactly as before', () => {
    for (const key of EXISTING_KEYS) {
      expect(getMetric(key), `missing existing key ${key}`).toBeDefined();
    }
  });

  it('gives every ordinal metric a non-empty label list, and only ordinal metrics have labels', () => {
    for (const m of METRICS) {
      if (m.valueType === 'ordinal') {
        expect(m.ordinalLabels, `${m.key} ordinalLabels`).toBeDefined();
        expect(m.ordinalLabels!.length, `${m.key} ordinalLabels length`).toBeGreaterThan(0);
      } else {
        expect(m.ordinalLabels, `${m.key} should not define ordinalLabels`).toBeUndefined();
      }
    }
  });

  it('pain_level is a plain number metric (ordinal is reserved for label-based scales)', () => {
    const pain = getMetric('pain_level');
    expect(pain).toBeDefined();
    expect(pain!.valueType).toBe('number');
    expect(pain!.ordinalLabels).toBeUndefined();
  });

  it('has a CATEGORY_LABELS entry for every category in use', () => {
    for (const m of METRICS) {
      expect(CATEGORY_LABELS[m.category], `label for category ${m.category}`).toBeTruthy();
    }
  });

  it('CATEGORY_ORDER lists every category exactly once, matching CATEGORY_LABELS', () => {
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
    expect([...CATEGORY_ORDER].sort()).toEqual(
      (Object.keys(CATEGORY_LABELS) as MetricCategory[]).sort(),
    );
    // Rendering order is part of the contract (UI sections + AI prompt).
    expect(CATEGORY_ORDER[0]).toBe('sleep');
    expect(CATEGORY_ORDER[CATEGORY_ORDER.length - 1]).toBe('subjective');
  });

  it('covers every declared category with at least one metric', () => {
    const inUse = new Set(METRICS.map((m) => m.category));
    for (const cat of Object.keys(CATEGORY_LABELS) as MetricCategory[]) {
      expect(inUse.has(cat), `no metrics in category ${cat}`).toBe(true);
    }
  });

  it('marks intraday metrics: blood_glucose and blood pressure', () => {
    expect(getMetric('blood_glucose')?.intraday).toBe(true);
    expect(getMetric('bp_systolic')?.intraday).toBe(true);
    expect(getMetric('bp_diastolic')?.intraday).toBe(true);
  });

  it('METRIC_MAP mirrors METRICS and getMetric resolves known/unknown keys', () => {
    expect(METRIC_MAP.size).toBe(METRICS.length);
    expect(getMetric('hrv_rmssd')).toBeDefined();
    expect(getMetric('hrv_rmssd')!.unit).toBe('ms');
    expect(getMetric('not_a_metric')).toBeUndefined();
  });

  it('keeps current chart buckets for pre-existing metrics', () => {
    for (const key of ['sleep_score', 'sleep_duration', 'steps', 'ahi']) {
      expect(getMetric(key)!.chart, `${key} chart`).toBe('bar');
    }
    for (const key of ['resting_hr', 'hrv_rmssd', 'spo2', 'bp_systolic', 'bp_diastolic']) {
      expect(getMetric(key)!.chart, `${key} chart`).toBe('stat');
    }
  });

  it('uses sum aggregation for cumulative daily metrics and latest for body metrics', () => {
    for (const key of [
      'steps',
      'active_calories',
      'total_calories',
      'distance',
      'active_minutes',
      'floors_climbed',
      'water_intake',
    ]) {
      expect(getMetric(key)!.aggregate, `${key} aggregate`).toBe('sum');
    }
    for (const m of METRICS) {
      if (m.category === 'body_composition' || m.category === 'body_measurement') {
        expect(m.aggregate, `${m.key} aggregate`).toBe('latest');
      }
    }
  });
});
