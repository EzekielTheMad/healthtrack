// ---------------------------------------------------------------------------
// Catalog of vital metrics for dashboard stat cards — derived from the
// metric registry (src/lib/metrics/registry.ts), the single source of truth.
// ---------------------------------------------------------------------------

import { METRICS, CATEGORY_LABELS, type MetricDef } from '@/lib/metrics/registry';

export interface MetricDefinition {
  metricKey: string;
  label: string;
  displayUnit: string;
  category: string;
  description: string;
  requiresDevice: boolean;
  formatValue: (v: number) => string;
}

/** Compact display forms for stored canonical units. */
const DISPLAY_UNIT_OVERRIDES: Record<string, string> = {
  hours: 'hrs',
};

/** Descriptions carried over from the original hand-written catalog. */
const DESCRIPTIONS: Record<string, string> = {
  sleep_duration: 'Total sleep duration',
  ahi: 'Apnea-Hypopnea Index (CPAP users)',
  resting_hr: 'Resting heart rate',
  hrv_rmssd: 'Heart rate variability (RMSSD)',
  spo2: 'Blood oxygen saturation',
  bp_systolic: 'Systolic blood pressure',
  bp_diastolic: 'Diastolic blood pressure',
};

/**
 * Metrics that only arrive via a connected device/bridge (composite or
 * device-computed values). Everything else can be read off a home device or
 * self-assessed and entered manually.
 */
const DEVICE_ONLY_KEYS = new Set([
  // sleep (wearable-computed)
  'sleep_score', 'sleep_duration', 'sleep_efficiency', 'sleep_latency',
  'deep_sleep', 'light_sleep', 'rem_sleep', 'awake_time', 'time_in_bed',
  'restless_periods', 'avg_sleep_hr', 'body_temp_deviation',
  // respiratory / CPAP machine
  'ahi', 'cpap_usage', 'mask_leak', 'myair_score', 'bdi',
  // recovery (wearable-computed)
  'readiness_score', 'hrv_rmssd', 'resilience', 'stress_high', 'recovery_high',
  // activity (device-estimated)
  'active_calories', 'total_calories', 'activity_score', 'vo2_max',
  // smart-scale composition estimates
  'bmi', 'body_fat_pct', 'body_water_pct', 'muscle_mass_pct', 'bone_mass_pct',
  'protein_pct', 'subcutaneous_fat_pct', 'visceral_fat', 'fat_free_mass',
  'bmr', 'body_age',
]);

function toDefinition(m: MetricDef): MetricDefinition {
  const decimals = m.decimals ?? 0;
  return {
    metricKey: m.key,
    label: m.label,
    displayUnit: m.unit ? (DISPLAY_UNIT_OVERRIDES[m.unit] ?? m.unit) : '',
    category: CATEGORY_LABELS[m.category],
    description: DESCRIPTIONS[m.key] ?? '',
    requiresDevice: DEVICE_ONLY_KEYS.has(m.key),
    formatValue: (v) => v.toFixed(decimals),
  };
}

export const METRIC_CATALOG: MetricDefinition[] = METRICS.filter(
  (m) => m.dashboardEligible !== false,
).map(toDefinition);

/** Default vital metrics for users who connected a wearable device. */
export const DEVICE_DEFAULTS = ['sleep_duration', 'resting_hr', 'hrv_rmssd', 'spo2'];

/** Default vital metrics for users without a connected device. */
export const MANUAL_DEFAULTS = ['bp_systolic', 'bp_diastolic', 'resting_hr', 'spo2'];

/** Look up a vital metric definition by key. */
export function getMetricDefinition(metricKey: string): MetricDefinition | undefined {
  return METRIC_CATALOG.find((m) => m.metricKey === metricKey);
}

/** Build a MetricDefinition-like object for a lab result to render in the same card format. */
export function buildLabResultDefinition(
  testName: string,
  unit: string | null,
): MetricDefinition {
  return {
    metricKey: testName,
    label: testName,
    displayUnit: unit ?? '',
    category: 'Lab Result',
    description: testName,
    requiresDevice: false,
    formatValue: (v) => {
      if (Number.isInteger(v)) return v.toString();
      return v.toFixed(1);
    },
  };
}
