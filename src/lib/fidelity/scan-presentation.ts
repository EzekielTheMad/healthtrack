import type { BodyScan } from './contracts';
import { getScanMetric, isSourceDefinedScanMetric } from '@/lib/metrics/scan-registry';
import { deriveScanMeasurements } from './scan-derivations';
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
    current.scan.provenance.verification === 'conflict' ||
    baseline.scan.provenance.verification === 'conflict'
  )
    warnings.push(
      'Source evidence is marked conflicting; comparison deltas are withheld pending review.'
    );
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
  if (scanMetricComparisonWarnings(current, baseline, metricKey).length) return null;
  const a = current.measurements.find((m) => m.metric_key === metricKey);
  const b = baseline.measurements.find((m) => m.metric_key === metricKey);
  return a && b && a.unit === b.unit && a.estimated === b.estimated ? a.value - b.value : null;
}

/** Same name/unit does not prove the same regional ratio, SMI definition or phase-angle protocol. */
export function scanMetricComparisonWarnings(
  current: BodyScan,
  baseline: BodyScan,
  metricKey: string
): string[] {
  const warnings = scanComparisonWarnings(current, baseline);
  const a = current.measurements.find((measurement) => measurement.metric_key === metricKey);
  const b = baseline.measurements.find((measurement) => measurement.metric_key === metricKey);
  if (!a || !b) return [...warnings, 'This metric is not reported in both selected scans.'];
  if (a.unit !== b.unit || a.estimated !== b.estimated)
    warnings.push('Units or measurement basis differ; comparison deltas are withheld.');
  if (a.definition !== b.definition)
    warnings.push('Source metric definitions differ; comparison deltas are withheld.');
  else if (isSourceDefinedScanMetric(metricKey) && (!a.definition || !b.definition))
    warnings.push('The source definition or protocol is unknown; comparison deltas are withheld.');
  return warnings;
}

export type ScanEvidenceRow = {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  basis: 'reported' | 'derived' | 'vendor';
  source: string;
  raw_text?: string;
  definition?: string;
  reference?: string;
  formula?: string;
  input_metric_keys?: string[];
};
type VendorResults = NonNullable<BodyScan['scan']['vendor_results']>;
type Reference = NonNullable<VendorResults['scores'][number]['reference']>;
function referenceText(reference?: Reference): string | undefined {
  if (!reference) return undefined;
  return (
    [
      reference.low != null
        ? `Lower: ${reference.low}${reference.unit ? ` ${reference.unit}` : ''}`
        : '',
      reference.high != null
        ? `Upper: ${reference.high}${reference.unit ? ` ${reference.unit}` : ''}`
        : '',
      reference.text ?? '',
    ]
      .filter(Boolean)
      .join('; ') || undefined
  );
}

/** Shared export/context/UI evidence. Never interprets vendor recommendations as adopted targets. */
export function scanEvidenceRows(scan: BodyScan): ScanEvidenceRow[] {
  const source = [
    scan.scan.source,
    scan.scan.manufacturer,
    scan.scan.model,
    scan.scan.method.toUpperCase(),
  ]
    .filter(Boolean)
    .join(' · ');
  const reported: ScanEvidenceRow[] = scan.measurements.map((measurement) => ({
    key: measurement.metric_key,
    label: getScanMetric(measurement.metric_key)?.label ?? measurement.metric_key,
    value: String(measurement.source_value),
    unit: measurement.source_unit,
    basis: 'reported',
    source,
    ...(measurement.raw_text !== undefined ? { raw_text: measurement.raw_text } : {}),
    ...(measurement.definition ? { definition: measurement.definition } : {}),
  }));
  const derived: ScanEvidenceRow[] = deriveScanMeasurements(scan.measurements).map(
    (measurement) => ({
      key: `derived:${measurement.metric_key}`,
      label: `${getScanMetric(measurement.metric_key)?.label ?? measurement.metric_key} · derived from this scan`,
      value: String(measurement.value),
      unit: measurement.unit,
      basis: 'derived',
      source,
      formula: measurement.formula,
      input_metric_keys: measurement.input_metric_keys,
    })
  );
  const vendor = scan.scan.vendor_results;
  if (!vendor) return [...reported, ...derived];
  const outputs: ScanEvidenceRow[] = vendor.scores.map((score, index) => ({
    key: `vendor:score:${index}:${score.key}`,
    label: `${score.name} · source score`,
    value: String(score.value),
    unit: score.unit ?? null,
    basis: 'vendor',
    source,
    ...(score.definition ? { definition: score.definition } : {}),
    ...(referenceText(score.reference) ? { reference: referenceText(score.reference) } : {}),
  }));
  if (vendor.body_age)
    outputs.push({
      key: 'vendor:body_age',
      label: 'Body age · source estimate',
      value: String(vendor.body_age.value),
      unit: vendor.body_age.unit,
      basis: 'vendor',
      source,
      ...(vendor.body_age.definition ? { definition: vendor.body_age.definition } : {}),
      ...(referenceText(vendor.body_age.reference)
        ? { reference: referenceText(vendor.body_age.reference) }
        : {}),
    });
  vendor.reference_bands.forEach((band, index) =>
    outputs.push({
      key: `vendor:reference:${index}`,
      label: `${band.label} · source reference band`,
      value: referenceText(band.reference) ?? 'Range not specified',
      unit: null,
      basis: 'vendor',
      source,
      ...(band.metric_key ? { definition: `Source metric: ${band.metric_key}` } : {}),
    })
  );
  vendor.recommendations.forEach((recommendation, index) =>
    outputs.push({
      key: `vendor:recommendation:${index}`,
      label: `${recommendation.name} · source recommendation, not an adopted target`,
      value:
        recommendation.value != null
          ? `${recommendation.text} · ${recommendation.value}`
          : recommendation.text,
      unit: recommendation.unit ?? null,
      basis: 'vendor',
      source,
    })
  );
  return [...reported, ...derived, ...outputs];
}
