// ---------------------------------------------------------------------------
// Shared metric display formatting.
//
// One home for the small value-rendering rules the vitals surfaces share:
// registry-decimals clamping with thousands separators, h/m durations for
// minute-based sleep metrics, and the compact display-unit convention
// ('hours' → 'hrs', matching src/lib/dashboard-metrics.ts). Stored/canonical
// units never change here — this is display only.
// ---------------------------------------------------------------------------

import type { MetricDef } from './registry';

/**
 * Numeric display clamped to `decimals` with trailing zeros stripped and
 * thousands separators (12345.6 @ 0 → "12,346"; 210.50 @ 1 → "210.5").
 */
export function formatMetricValue(value: number, decimals: number): string {
  return Number(value.toFixed(decimals)).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
  });
}

/** Minutes → compact duration: 462 → "7h 42m", 45 → "45m", 120 → "2h". */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Minute-based sleep metrics render totals as h/m durations. */
export function isDurationMetric(metric: MetricDef | undefined): boolean {
  return metric !== undefined && metric.category === 'sleep' && metric.unit === 'min';
}

/** Compact display form of a stored unit ('hours' → 'hrs'); null → ''. */
export function displayUnit(unit: string | null): string {
  if (unit === 'hours') return 'hrs';
  return unit ?? '';
}
