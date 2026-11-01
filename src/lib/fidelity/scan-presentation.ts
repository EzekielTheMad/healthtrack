import type { BodyScan } from './contracts';
export function scanDeviceKey(row: BodyScan) {
  return JSON.stringify([
    row.scan.source,
    row.scan.manufacturer ?? null,
    row.scan.model ?? null,
    row.scan.method,
  ]);
}
export function scanComparisonWarnings(current: BodyScan, baseline: BodyScan): string[] {
  const warnings: string[] = [];
  if (
    !current.scan.manufacturer ||
    !current.scan.model ||
    !baseline.scan.manufacturer ||
    !baseline.scan.model ||
    current.scan.method === 'unknown' ||
    baseline.scan.method === 'unknown'
  )
    warnings.push('Device identity or measurement method is incomplete; comparability is unknown.');
  if (scanDeviceKey(current) !== scanDeviceKey(baseline))
    warnings.push('Different source, device or method: these scans are not directly comparable.');
  const a = current.scan.conditions;
  const b = baseline.scan.conditions;
  if (
    !a ||
    !b ||
    a.workout_status === 'unknown' ||
    b.workout_status === 'unknown' ||
    a.fasting_status === 'unknown' ||
    b.fasting_status === 'unknown'
  )
    warnings.push(
      'Collection conditions are unknown; a numerical change does not establish tissue gain or loss.'
    );
  else if (a.workout_status !== b.workout_status || a.fasting_status !== b.fasting_status)
    warnings.push('Workout or fasting conditions differ; comparison deltas are withheld.');
  if (
    !['day', 'instant'].includes(current.scan.measured_at.precision) ||
    !['day', 'instant'].includes(baseline.scan.measured_at.precision) ||
    current.scan.measured_at.approximate ||
    baseline.scan.measured_at.approximate
  )
    warnings.push('Partial or unknown measurement dates do not establish an exact chronology.');
  return warnings;
}
export function scanMetricDelta(
  current: BodyScan,
  baseline: BodyScan,
  metricKey: string
): number | null {
  if (scanComparisonWarnings(current, baseline).length) return null;
  const a = current.measurements.find((m) => m.metric_key === metricKey);
  const b = baseline.measurements.find((m) => m.metric_key === metricKey);
  return a && b && a.unit === b.unit && a.estimated === b.estimated ? a.value - b.value : null;
}
