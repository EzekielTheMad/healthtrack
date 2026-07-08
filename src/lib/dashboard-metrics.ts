// ---------------------------------------------------------------------------
// Central catalog of all available vital metrics for dashboard stat cards.
// ---------------------------------------------------------------------------

export interface MetricDefinition {
  metricKey: string;
  label: string;
  displayUnit: string;
  category: string;
  description: string;
  requiresDevice: boolean;
  formatValue: (v: number) => string;
}

export const METRIC_CATALOG: MetricDefinition[] = [
  {
    metricKey: 'sleep_duration',
    label: 'Sleep Score',
    displayUnit: 'hrs',
    category: 'Sleep',
    description: 'Total sleep duration',
    requiresDevice: true,
    formatValue: (v) => v.toFixed(1),
  },
  {
    metricKey: 'ahi',
    label: 'APAP / AHI',
    displayUnit: 'events/hr',
    category: 'Sleep',
    description: 'Apnea-Hypopnea Index (CPAP users)',
    requiresDevice: true,
    formatValue: (v) => v.toFixed(1),
  },
  {
    metricKey: 'resting_hr',
    label: 'Resting HR',
    displayUnit: 'bpm',
    category: 'Heart',
    description: 'Resting heart rate',
    requiresDevice: false,
    formatValue: (v) => Math.round(v).toString(),
  },
  {
    metricKey: 'hrv_rmssd',
    label: 'HRV',
    displayUnit: 'ms',
    category: 'Heart',
    description: 'Heart rate variability (RMSSD)',
    requiresDevice: true,
    formatValue: (v) => Math.round(v).toString(),
  },
  {
    metricKey: 'spo2',
    label: 'SpO2',
    displayUnit: '%',
    category: 'Respiratory',
    description: 'Blood oxygen saturation',
    requiresDevice: false,
    formatValue: (v) => Math.round(v).toString(),
  },
  {
    metricKey: 'bp_systolic',
    label: 'BP (Systolic)',
    displayUnit: 'mmHg',
    category: 'Blood Pressure',
    description: 'Systolic blood pressure',
    requiresDevice: false,
    formatValue: (v) => Math.round(v).toString(),
  },
  {
    metricKey: 'bp_diastolic',
    label: 'BP (Diastolic)',
    displayUnit: 'mmHg',
    category: 'Blood Pressure',
    description: 'Diastolic blood pressure',
    requiresDevice: false,
    formatValue: (v) => Math.round(v).toString(),
  },
];

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
