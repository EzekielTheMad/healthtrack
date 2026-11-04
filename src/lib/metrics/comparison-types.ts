/** Client-safe contract for the session-only, single-person comparison endpoint. */
export type ComparisonDays = 30 | 90;
export type ComparisonDomain = 'vitals' | 'nutrition' | 'fitness';
export type ComparisonAggregation = 'mean' | 'sum' | 'latest';

export interface ComparisonPoint {
  date: string;
  /** Unknown or unrecorded is null; a recorded zero remains zero. */
  value: number | null;
}

export interface ComparisonSource {
  source: string;
  label: string;
  points: ComparisonPoint[];
  recorded_days: number;
}

export interface ComparisonMetric {
  key: string;
  label: string;
  unit: string | null;
  domain: ComparisonDomain;
  /** Operation used within a day, rather than across the requested window. */
  aggregation: ComparisonAggregation;
  /** Null requires a visible choice. An explicit preference may have no data. */
  selected_source: string | null;
  sources: ComparisonSource[];
}

export interface ComparisonResponse {
  days: ComparisonDays;
  start_date: string;
  end_date: string;
  time_zone: string;
  metrics: ComparisonMetric[];
  unavailable_domains: ComparisonDomain[];
  warnings: string[];
}
