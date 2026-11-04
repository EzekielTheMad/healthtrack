/** Accept repository rows and public API rows without translating either contract. */
export interface SourceSelectableVital {
  metric_key?: string;
  metricKey?: string;
  recorded_at?: string;
  recordedAt?: string;
  source?: string;
}

export type VitalSourcePreferences = Readonly<Record<string, string>>;
const ACTIVITY_TOTALS = new Set(['steps', 'distance', 'active_calories', 'total_calories']);
const metricOf = (row: SourceSelectableVital) => row.metric_key ?? row.metricKey ?? '';

export interface VitalSourceConflict {
  metricKey: string;
  sources: string[];
  selectedSource: string | null;
  needsChoice: boolean;
}

/** One source per metric, so a range never silently switches devices between days. */
export function sourceConflicts(
  rows: readonly SourceSelectableVital[],
  preferences: VitalSourcePreferences = {}
): VitalSourceConflict[] {
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.source) continue; // legacy/synthetic rows without provenance remain usable
    const key = metricOf(row);
    const sources = groups.get(key) ?? new Set<string>();
    sources.add(row.source);
    groups.set(key, sources);
  }
  return [...groups]
    .map(([metricKey, set]) => {
      const sources = [...set].sort();
      const selectedSource =
        preferences[metricKey] ??
        (ACTIVITY_TOTALS.has(metricKey) && set.has('health_connect_daily')
          ? 'health_connect_daily'
          : sources.length === 1
            ? sources[0]
            : null);
      return { metricKey, sources, selectedSource, needsChoice: selectedSource === null };
    })
    .sort((a, b) => a.metricKey.localeCompare(b.metricKey));
}

/**
 * Read-time selection only: never delete competing observations or sum devices.
 * Explicit preferences stay authoritative even when that source has a gap.
 */
export function selectVitalSources<T extends SourceSelectableVital>(
  rows: readonly T[],
  preferences: VitalSourcePreferences = {}
): T[] {
  const choices = new Map(
    sourceConflicts(rows, preferences).map((c) => [c.metricKey, c.selectedSource])
  );
  return rows.filter((row) => !row.source || choices.get(metricOf(row)) === row.source);
}
