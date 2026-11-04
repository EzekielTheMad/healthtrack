import type { VitalRow } from '@/lib/repos/vitals';
import { listVitalSourcePreferences } from '@/lib/repos/vitals';
import { listBodyScans, selectCoherentScan } from './scans';
import { unknownClinicalDate } from './contracts';
import { calendarDayInTimeZone, getHealthTrackTimeZone } from '@/lib/oura/timezone';

/** Preserve useful legacy provenance without unbounded arbitrary metadata. */
export function boundedVitalMetadata(metadata: unknown) {
  let truncated = false;
  function visit(value: unknown, depth: number): unknown {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      if (value.length > 500) truncated = true;
      return value.slice(0, 500);
    }
    if (depth >= 3) {
      truncated = true;
      return null;
    }
    if (Array.isArray(value)) {
      if (value.length > 20) truncated = true;
      return value.slice(0, 20).map((item) => visit(item, depth + 1));
    }
    if (typeof value === 'object' && value) {
      const entries = Object.entries(value);
      if (entries.length > 20) truncated = true;
      return Object.fromEntries(
        entries.slice(0, 20).map(([key, item]) => [key.slice(0, 100), visit(item, depth + 1)])
      );
    }
    return null;
  }
  const result = visit(metadata, 0);
  if (JSON.stringify(result).length > 4096) return { metadata: null, metadata_truncated: true };
  return { metadata: result, metadata_truncated: truncated };
}
export function typedVital(row: VitalRow) {
  return {
    id: row.id,
    metric_key: row.metricKey,
    value: row.value,
    unit: row.unit,
    source: row.source,
    recorded_at: row.recordedAt,
    last_received_at: row.lastReceivedAt,
    date_provenance: unknownClinicalDate(row.recordedAt),
    ...boundedVitalMetadata(row.metadata),
  };
}
export async function typedVitalHistory(
  userId: string,
  rows: VitalRow[],
  options: {
    metric?: string;
    startDate?: string;
    endDate?: string;
    limit: number;
    source?: string;
    fromDay?: boolean;
    toDay?: boolean;
  }
) {
  const allScans = await listBodyScans(
    userId,
    { ownerId: userId, dependentId: null },
    { limit: 1000, source: options.source }
  );
  let excludedDateCount = 0;
  const scans = allScans
    .filter((row) => {
      if (options.metric && !row.measurements.some((m) => m.metric_key === options.metric))
        return false;
      if (!options.startDate && !options.endDate) return true;
      const date = row.scan.measured_at;
      if (!['day', 'instant'].includes(date.precision) || date.value === null || date.approximate) {
        excludedDateCount++;
        return false;
      }
      if (date.precision === 'instant') {
        const instant = Date.parse(date.value);
        const day = calendarDayInTimeZone(new Date(instant), getHealthTrackTimeZone());
        return (
          (!options.startDate ||
            (options.fromDay
              ? day >= options.startDate.slice(0, 10)
              : instant >= Date.parse(options.startDate))) &&
          (!options.endDate ||
            (options.toDay
              ? day <= options.endDate.slice(0, 10)
              : instant <= Date.parse(options.endDate)))
        );
      }
      const day = date.value;
      if (
        (options.startDate && !options.fromDay && day === options.startDate.slice(0, 10)) ||
        (options.endDate && !options.toDay && day === options.endDate.slice(0, 10))
      ) {
        excludedDateCount++;
        return false;
      }
      return (
        (!options.startDate || day >= options.startDate.slice(0, 10)) &&
        (!options.endDate || day <= options.endDate.slice(0, 10))
      );
    })
    .slice(0, Math.min(options.limit, 100));
  const preferences = Object.fromEntries(
    (await listVitalSourcePreferences(userId)).map((row) => [row.metricKey, row.preferredSource])
  );
  return {
    format: 'typed',
    legacy: rows.map(typedVital),
    scans,
    scan_selection: selectCoherentScan(
      scans,
      preferences,
      options.source,
      options.metric ? [options.metric] : undefined
    ),
    source_preferences: preferences,
    coverage: {
      returned_legacy: rows.length,
      legacy_limit: options.limit,
      legacy_may_be_truncated: rows.length === options.limit,
      returned_scans: scans.length,
      max_scan_history: 1000,
      scan_limit: Math.min(options.limit, 100),
      scans_may_be_truncated: scans.length === Math.min(options.limit, 100),
      partial_dates_excluded_by_window: excludedDateCount,
      insufficient_date_precision_excluded_by_window: excludedDateCount,
      default_format_excludes_scan_facts: true,
      scan_values_are_coherent_sessions: true,
    },
  };
}
export async function typedVitalLatest(
  userId: string,
  rows: Record<string, VitalRow | null>,
  metrics: string[],
  source?: string
) {
  const scans = await listBodyScans(
    userId,
    { ownerId: userId, dependentId: null },
    { limit: 1000, source }
  );
  const preferences = Object.fromEntries(
    (await listVitalSourcePreferences(userId)).map((row) => [row.metricKey, row.preferredSource])
  );
  const selected = selectCoherentScan(scans, preferences, source, metrics);
  return {
    format: 'typed',
    legacy_latest: Object.fromEntries(
      Object.entries(rows).map(([key, row]) => [key, row ? typedVital(row) : null])
    ),
    scan_latest: selected,
    source_preferences: preferences,
    coverage: {
      max_scan_history: 1000,
      missing_scan_metrics: metrics.filter(
        (key) => !selected.scan?.measurements.some((m) => m.metric_key === key)
      ),
      default_format_excludes_scan_facts: true,
      partial_dates_excluded_from_latest: true,
      no_metric_wise_scan_assembly: true,
    },
  };
}
