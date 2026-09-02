import { describe, it, expect } from 'vitest';
import {
  BODY_MEASUREMENT_KEYS,
  METRICS,
  METRIC_MAP,
  getMetric,
  metricsInCategory,
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
  // Body measurements that predate the provider-neutral circumference
  // vocabulary — their spelling and semantics must never shift.
  'neck',
  'chest',
  'waist',
  'hips',
  'bicep',
  'thigh',
  'calf',
];

/** The full canonical circumference vocabulary, unsided and sided. */
const BODY_MEASUREMENT_VOCABULARY: [key: string, label: string][] = [
  ['waist', 'Waist'],
  ['abdomen', 'Abdomen'],
  ['hips', 'Hips'],
  ['neck', 'Neck'],
  ['shoulder', 'Shoulder'],
  ['chest', 'Chest'],
  ['bicep', 'Bicep'],
  ['left_bicep', 'Left Bicep'],
  ['right_bicep', 'Right Bicep'],
  ['forearm', 'Forearm'],
  ['left_forearm', 'Left Forearm'],
  ['right_forearm', 'Right Forearm'],
  ['thigh', 'Thigh'],
  ['left_thigh', 'Left Thigh'],
  ['right_thigh', 'Right Thigh'],
  ['calf', 'Calf'],
  ['left_calf', 'Left Calf'],
  ['right_calf', 'Right Calf'],
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

  it('marks delta goal directions: lower/higher-is-better and neutral metrics', () => {
    for (const key of [
      'resting_hr', 'ahi', 'mask_leak', 'sleep_latency', 'awake_time',
      'restless_periods', 'body_fat_pct', 'weight',
    ]) {
      expect(getMetric(key)!.goalDirection, key).toBe('lower');
    }
    for (const key of ['steps', 'hrv_rmssd', 'readiness_score', 'sleep_duration', 'spo2']) {
      expect(getMetric(key)!.goalDirection, key).toBe('higher');
    }
    // Range-based or ambiguous metrics stay neutral (no direction).
    for (const key of [
      'bp_systolic', 'bp_diastolic', 'body_temp', 'blood_glucose',
      'respiratory_rate', 'time_in_bed', 'waist',
    ]) {
      expect(getMetric(key)!.goalDirection, key).toBeUndefined();
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

  it('registers the whole canonical circumference vocabulary with its labels', () => {
    for (const [key, label] of BODY_MEASUREMENT_VOCABULARY) {
      const m = getMetric(key);
      expect(m, `missing body measurement ${key}`).toBeDefined();
      expect(m!.label, `${key} label`).toBe(label);
      expect(m!.category, `${key} category`).toBe('body_measurement');
    }
    // Closed set: no body_measurement metric outside the vocabulary above.
    expect([...BODY_MEASUREMENT_KEYS].sort()).toEqual(
      BODY_MEASUREMENT_VOCABULARY.map(([k]) => k).sort(),
    );
  });

  it('gives every circumference the same canonical shape (in / stat / latest / 0.1)', () => {
    for (const m of metricsInCategory('body_measurement')) {
      expect(m.unit, `${m.key} unit`).toBe('in');
      expect(m.valueType, `${m.key} valueType`).toBe('number');
      expect(m.chart, `${m.key} chart`).toBe('stat');
      expect(m.aggregate, `${m.key} aggregate`).toBe('latest');
      expect(m.decimals, `${m.key} decimals`).toBe(1);
      // Circumference has no universally "better" direction.
      expect(m.goalDirection, `${m.key} goalDirection`).toBeUndefined();
      // Day-level like every other tape/scale metric.
      expect(m.intraday, `${m.key} intraday`).toBeUndefined();
    }
  });

  it('keeps left/right circumferences as independent registry entries', () => {
    for (const base of ['bicep', 'forearm', 'thigh', 'calf']) {
      // The unsided key survives as its own series alongside the sided ones.
      for (const key of [base, `left_${base}`, `right_${base}`]) {
        expect(getMetric(key), key).toBeDefined();
      }
      expect(getMetric(`left_${base}`)).not.toBe(getMetric(`right_${base}`));
    }
  });

  it('BODY_MEASUREMENT_KEYS is derived from METRICS, in registry order', () => {
    expect(BODY_MEASUREMENT_KEYS).toEqual(
      METRICS.filter((m) => m.category === 'body_measurement').map((m) => m.key),
    );
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
