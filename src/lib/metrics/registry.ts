// ---------------------------------------------------------------------------
// Metric registry — single source of truth for every vital/device metric.
//
// All metric lists in the app (dashboard catalog, vitals page buckets, manual
// entry options, reference-range fallbacks, API validation) derive from
// METRICS. New metrics are added HERE and nowhere else (closed registry).
// ---------------------------------------------------------------------------

export type MetricCategory =
  | 'sleep'
  | 'respiratory'
  | 'recovery'
  | 'cardiovascular'
  | 'activity'
  | 'body_composition'
  | 'body_measurement'
  | 'metabolic'
  | 'subjective';

export interface MetricDef {
  key: string;
  label: string;
  category: MetricCategory;
  unit: string | null;
  valueType: 'number' | 'ordinal';
  ordinalLabels?: readonly string[]; // value = index + 1
  chart: 'bar' | 'stat' | 'trend';
  aggregate: 'mean' | 'sum' | 'latest';
  decimals?: number;
  dashboardEligible?: boolean; // default true
  intraday?: boolean; // keep full timestamps (blood_glucose, bp_*)
  /**
   * Which direction of change reads as an improvement, driving delta/trend
   * coloring everywhere (focus stats, daily deltas, sparklines). Unset means
   * the metric is neutral (or range-based, like blood pressure) and changes
   * render without a good/bad tint. 'lower' encodes this app's weight-loss
   * context for weight/BMI, matching the focus body-composition verdict.
   */
  goalDirection?: 'higher' | 'lower';
  /**
   * Optional inclusive value bounds, enforced by the write path
   * (validateVitalWrite in src/lib/repos/vitals.ts). Only set where a metric
   * has a hard scale (pain_level 0–10); clinical plausibility ranges live in
   * vital_reference_ranges, not here.
   */
  min?: number;
  max?: number;
}

/**
 * Canonical display order for category sections — vitals page, manual-entry
 * optgroups, docs metric table, and AI prompt formatting all follow this.
 */
export const CATEGORY_ORDER: readonly MetricCategory[] = [
  'sleep',
  'respiratory',
  'recovery',
  'cardiovascular',
  'activity',
  'body_composition',
  'body_measurement',
  'metabolic',
  'subjective',
];

export const CATEGORY_LABELS: Record<MetricCategory, string> = {
  sleep: 'Sleep',
  respiratory: 'Respiratory & CPAP',
  recovery: 'Recovery',
  cardiovascular: 'Cardiovascular',
  activity: 'Activity',
  body_composition: 'Body Composition',
  body_measurement: 'Measurements',
  metabolic: 'Metabolic',
  subjective: 'Subjective',
};

export const METRICS: readonly MetricDef[] = [
  // ── Sleep ─────────────────────────────────────────────────────────────────
  { key: 'sleep_score', label: 'Sleep Score', category: 'sleep', unit: null, valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'sleep_duration', label: 'Sleep Duration', category: 'sleep', unit: 'hours', valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 1, goalDirection: 'higher' },
  { key: 'sleep_efficiency', label: 'Sleep Efficiency', category: 'sleep', unit: '%', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'sleep_latency', label: 'Sleep Latency', category: 'sleep', unit: 'min', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'lower' },
  { key: 'deep_sleep', label: 'Deep Sleep', category: 'sleep', unit: 'min', valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'light_sleep', label: 'Light Sleep', category: 'sleep', unit: 'min', valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 0 },
  { key: 'rem_sleep', label: 'REM Sleep', category: 'sleep', unit: 'min', valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'awake_time', label: 'Awake Time', category: 'sleep', unit: 'min', valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 0, goalDirection: 'lower' },
  { key: 'time_in_bed', label: 'Time in Bed', category: 'sleep', unit: 'min', valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 0 },
  { key: 'restless_periods', label: 'Restless Periods', category: 'sleep', unit: null, valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'lower' },
  { key: 'avg_sleep_hr', label: 'Avg Sleep HR', category: 'sleep', unit: 'bpm', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'lower' },
  { key: 'body_temp_deviation', label: 'Body Temp Deviation', category: 'sleep', unit: '°F', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 1 },

  // ── Respiratory & CPAP ────────────────────────────────────────────────────
  { key: 'ahi', label: 'AHI', category: 'respiratory', unit: 'events/hr', valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 1, goalDirection: 'lower' },
  { key: 'spo2', label: 'SpO2', category: 'respiratory', unit: '%', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'respiratory_rate', label: 'Respiratory Rate', category: 'respiratory', unit: 'breaths/min', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 1 },
  { key: 'cpap_usage', label: 'CPAP Usage', category: 'respiratory', unit: 'hours', valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 1, goalDirection: 'higher' },
  { key: 'mask_leak', label: 'Mask Leak', category: 'respiratory', unit: 'L/min', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 1, goalDirection: 'lower' },
  { key: 'myair_score', label: 'myAir Score', category: 'respiratory', unit: null, valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'peak_flow', label: 'Peak Flow', category: 'respiratory', unit: 'L/min', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'bdi', label: 'Breathing Disturbance Index', category: 'respiratory', unit: null, valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 1, goalDirection: 'lower' },

  // ── Recovery ──────────────────────────────────────────────────────────────
  { key: 'readiness_score', label: 'Readiness Score', category: 'recovery', unit: null, valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'hrv_rmssd', label: 'HRV', category: 'recovery', unit: 'ms', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'resilience', label: 'Resilience', category: 'recovery', unit: null, valueType: 'ordinal', ordinalLabels: ['limited', 'adequate', 'solid', 'strong', 'exceptional'], chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'stress_high', label: 'Stress High Time', category: 'recovery', unit: 'min', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'lower' },
  { key: 'recovery_high', label: 'Recovery High Time', category: 'recovery', unit: 'min', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },

  // ── Cardiovascular ────────────────────────────────────────────────────────
  { key: 'resting_hr', label: 'Resting HR', category: 'cardiovascular', unit: 'bpm', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'lower' },
  { key: 'bp_systolic', label: 'BP Systolic', category: 'cardiovascular', unit: 'mmHg', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, intraday: true },
  { key: 'bp_diastolic', label: 'BP Diastolic', category: 'cardiovascular', unit: 'mmHg', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, intraday: true },
  { key: 'body_temp', label: 'Body Temperature', category: 'cardiovascular', unit: '°F', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 1 },
  { key: 'basal_body_temp', label: 'Basal Body Temperature', category: 'cardiovascular', unit: '°F', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 2 },

  // ── Activity ──────────────────────────────────────────────────────────────
  { key: 'steps', label: 'Steps', category: 'activity', unit: 'steps', valueType: 'number', chart: 'bar', aggregate: 'sum', decimals: 0, goalDirection: 'higher' },
  { key: 'active_calories', label: 'Active Calories', category: 'activity', unit: 'kcal', valueType: 'number', chart: 'bar', aggregate: 'sum', decimals: 0, goalDirection: 'higher' },
  { key: 'total_calories', label: 'Total Calories', category: 'activity', unit: 'kcal', valueType: 'number', chart: 'stat', aggregate: 'sum', decimals: 0 },
  { key: 'activity_score', label: 'Activity Score', category: 'activity', unit: null, valueType: 'number', chart: 'bar', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'vo2_max', label: 'VO2 Max', category: 'activity', unit: 'mL/kg/min', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 1, goalDirection: 'higher' },
  { key: 'distance', label: 'Distance', category: 'activity', unit: 'mi', valueType: 'number', chart: 'bar', aggregate: 'sum', decimals: 2, goalDirection: 'higher' },
  { key: 'active_minutes', label: 'Active Minutes', category: 'activity', unit: 'min', valueType: 'number', chart: 'bar', aggregate: 'sum', decimals: 0, goalDirection: 'higher' },
  { key: 'floors_climbed', label: 'Floors Climbed', category: 'activity', unit: 'floors', valueType: 'number', chart: 'bar', aggregate: 'sum', decimals: 0, goalDirection: 'higher' },

  // ── Body composition ──────────────────────────────────────────────────────
  { key: 'weight', label: 'Weight', category: 'body_composition', unit: 'lbs', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1, goalDirection: 'lower' },
  { key: 'bmi', label: 'BMI', category: 'body_composition', unit: null, valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1, goalDirection: 'lower' },
  { key: 'body_fat_pct', label: 'Body Fat %', category: 'body_composition', unit: '%', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1, goalDirection: 'lower' },
  { key: 'body_water_pct', label: 'Body Water %', category: 'body_composition', unit: '%', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1 },
  { key: 'muscle_mass_pct', label: 'Muscle Mass %', category: 'body_composition', unit: '%', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1, goalDirection: 'higher' },
  { key: 'bone_mass_pct', label: 'Bone Mass %', category: 'body_composition', unit: '%', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1 },
  { key: 'protein_pct', label: 'Protein %', category: 'body_composition', unit: '%', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1 },
  { key: 'subcutaneous_fat_pct', label: 'Subcutaneous Fat %', category: 'body_composition', unit: '%', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1, goalDirection: 'lower' },
  { key: 'visceral_fat', label: 'Visceral Fat', category: 'body_composition', unit: null, valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 0, goalDirection: 'lower' },
  { key: 'fat_free_mass', label: 'Fat-Free Mass', category: 'body_composition', unit: 'lbs', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1, goalDirection: 'higher' },
  { key: 'bmr', label: 'BMR', category: 'body_composition', unit: 'kcal', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 0 },
  { key: 'body_age', label: 'Body Age', category: 'body_composition', unit: 'years', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 0, goalDirection: 'lower' },

  // ── Body measurements (stored imperial, like weight) ──────────────────────
  { key: 'waist', label: 'Waist', category: 'body_measurement', unit: 'in', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1 },
  { key: 'hips', label: 'Hips', category: 'body_measurement', unit: 'in', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1 },
  { key: 'neck', label: 'Neck', category: 'body_measurement', unit: 'in', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1 },
  { key: 'chest', label: 'Chest', category: 'body_measurement', unit: 'in', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1 },
  { key: 'thigh', label: 'Thigh', category: 'body_measurement', unit: 'in', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1 },
  { key: 'bicep', label: 'Bicep', category: 'body_measurement', unit: 'in', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1 },
  { key: 'calf', label: 'Calf', category: 'body_measurement', unit: 'in', valueType: 'number', chart: 'stat', aggregate: 'latest', decimals: 1 },

  // ── Metabolic ─────────────────────────────────────────────────────────────
  { key: 'blood_glucose', label: 'Blood Glucose', category: 'metabolic', unit: 'mg/dL', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, intraday: true },
  { key: 'blood_ketones', label: 'Blood Ketones', category: 'metabolic', unit: 'mmol/L', valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 1 },

  // ── Subjective ────────────────────────────────────────────────────────────
  { key: 'mood', label: 'Mood', category: 'subjective', unit: null, valueType: 'ordinal', ordinalLabels: ['awful', 'poor', 'okay', 'good', 'great'], chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'energy', label: 'Energy', category: 'subjective', unit: null, valueType: 'ordinal', ordinalLabels: ['drained', 'low', 'normal', 'good', 'great'], chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'higher' },
  { key: 'stress_level', label: 'Stress Level', category: 'subjective', unit: null, valueType: 'ordinal', ordinalLabels: ['minimal', 'low', 'moderate', 'high', 'severe'], chart: 'stat', aggregate: 'mean', decimals: 0, goalDirection: 'lower' },
  // pain_level is a 0–10 numeric scale (min/max enforced by validateVitalWrite);
  // 'ordinal' is reserved for label-based scales.
  { key: 'pain_level', label: 'Pain Level', category: 'subjective', unit: null, valueType: 'number', chart: 'stat', aggregate: 'mean', decimals: 0, min: 0, max: 10, goalDirection: 'lower' },
  { key: 'water_intake', label: 'Water Intake', category: 'subjective', unit: 'oz', valueType: 'number', chart: 'bar', aggregate: 'sum', decimals: 0, goalDirection: 'higher' },
];

export const METRIC_MAP: ReadonlyMap<string, MetricDef> = new Map(
  METRICS.map((m) => [m.key, m]),
);

/** Look up a metric definition by canonical key. */
export function getMetric(key: string): MetricDef | undefined {
  return METRIC_MAP.get(key);
}
