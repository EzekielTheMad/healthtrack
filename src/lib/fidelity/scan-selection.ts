import type { BodyScan, ClinicalDate } from './contracts';
import type { VitalSourcePreferences } from '@/lib/metrics/source-selection';

function dateKey(date: ClinicalDate): string {
  // Precision remains intact; this is an ordering key, never a fabricated date.
  return date.precision === 'instant' ? new Date(date.value).toISOString() : (date.value ?? '');
}
export function compareScans(a: BodyScan, b: BodyScan): number {
  const left = a.scan.measured_at;
  const right = b.scan.measured_at;
  const byEvidence = dateKey(right).localeCompare(dateKey(left));
  return byEvidence || a.id.localeCompare(b.id);
}
/** Select one coherent session. Incomplete dates or competing day-only scans never become a fabricated latest instant. */
export function selectCoherentScan(
  scans: readonly BodyScan[],
  preferences: VitalSourcePreferences = {},
  requestedSource?: string,
  metricKeys?: readonly string[]
) {
  const metrics = new Set(
    metricKeys ?? scans.flatMap((row) => row.measurements.map((m) => m.metric_key))
  );
  const sources = [
    ...new Set(
      scans
        .filter((row) => row.measurements.some((m) => metrics.has(m.metric_key)))
        .map((row) => row.scan.source)
    ),
  ].sort();
  const preferred = [
    ...new Set(
      Object.entries(preferences)
        .filter(([metric]) => metrics.has(metric))
        .map(([, source]) => source)
    ),
  ];
  const source =
    requestedSource ||
    (preferred.length === 1
      ? preferred[0]
      : preferred.length === 0 && sources.length === 1
        ? sources[0]
        : null);
  const policy = requestedSource
    ? 'explicit_source'
    : preferred.length === 1
      ? 'saved_preference'
      : source
        ? 'single_source'
        : 'choice_required';
  const relevant = source
    ? scans.filter(
        (row) =>
          row.scan.source === source && row.measurements.some((m) => metrics.has(m.metric_key))
      )
    : [];
  const precise = relevant
    .filter(
      (row) =>
        ['day', 'instant'].includes(row.scan.measured_at.precision) &&
        !row.scan.measured_at.approximate
    )
    .sort(compareScans);
  const warnings: string[] = [];
  if (!source && sources.length)
    warnings.push(
      'Choose a source; metric-wise source preferences cannot be combined into one scan.'
    );
  if (source && !relevant.length)
    warnings.push('The selected source has no scan in the available history.');
  if (
    relevant.some(
      (row) =>
        !['day', 'instant'].includes(row.scan.measured_at.precision) ||
        row.scan.measured_at.approximate
    )
  )
    warnings.push(
      'Partial, approximate or unknown measurement dates remain in history and are excluded from latest selection.'
    );
  // Day-only dates are not UTC midnights. These uncertainty bounds are used only
  // to prove ordering, never emitted or stored as measurement timestamps.
  const bounds = (row: BodyScan): [number, number] => {
    const date = row.scan.measured_at;
    if (date.precision === 'instant') {
      const instant = Date.parse(date.value);
      return [instant, instant];
    }
    const civilDay = Date.parse(date.value + 'T00:00:00Z');
    return [civilDay - 14 * 3600000, civilDay + 36 * 3600000];
  };
  const intervals = precise.map((row) => ({ row, bounds: bounds(row) }));
  const maximumEarliest = Math.max(...intervals.map((item) => item.bounds[0]));
  const candidates = intervals
    .filter((item) => item.bounds[1] >= maximumEarliest)
    .map((item) => item.row);
  const latest: BodyScan | null = candidates.length === 1 ? candidates[0] : null;
  if (candidates.length > 1) {
    warnings.push(
      'Multiple scan times are equal or not comparable at the reported date precision. Select a session explicitly.'
    );
  }
  return {
    scan: latest,
    source,
    policy,
    sources,
    warnings,
    candidate_scan_ids: candidates.map((row) => row.id),
  };
}
