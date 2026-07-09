interface VitalRange {
  label: string;
  low: number;
  high: number;
  unit: string;
}

interface RangeEntry {
  label: string;
  low: number | null;
  high: number | null;
  unit: string;
  ageMin: number | null;
  ageMax: number | null;
  sex: "male" | "female" | null;
}

// ---------------------------------------------------------------------------
// Hardcoded fallback ranges matching the seed migration data.
// ---------------------------------------------------------------------------

const RANGES: Record<string, RangeEntry[]> = {
  resting_hr: [
    { label: "Normal", low: 60, high: 100, unit: "bpm", ageMin: 18, ageMax: null, sex: null },
    { label: "Bradycardia", low: null, high: 59, unit: "bpm", ageMin: 18, ageMax: null, sex: null },
    { label: "Tachycardia", low: 101, high: null, unit: "bpm", ageMin: 18, ageMax: null, sex: null },
    { label: "Normal", low: 70, high: 100, unit: "bpm", ageMin: 6, ageMax: 15, sex: null },
    { label: "Normal", low: 70, high: 190, unit: "bpm", ageMin: 0, ageMax: 1, sex: null },
  ],
  hrv_rmssd: [
    { label: "Low", low: null, high: 19, unit: "ms", ageMin: 18, ageMax: 39, sex: null },
    { label: "Normal", low: 20, high: 65, unit: "ms", ageMin: 18, ageMax: 39, sex: null },
    { label: "High", low: 66, high: null, unit: "ms", ageMin: 18, ageMax: 39, sex: null },
    { label: "Low", low: null, high: 14, unit: "ms", ageMin: 40, ageMax: 59, sex: null },
    { label: "Normal", low: 15, high: 50, unit: "ms", ageMin: 40, ageMax: 59, sex: null },
    { label: "High", low: 51, high: null, unit: "ms", ageMin: 40, ageMax: 59, sex: null },
    { label: "Low", low: null, high: 9, unit: "ms", ageMin: 60, ageMax: null, sex: null },
    { label: "Normal", low: 10, high: 40, unit: "ms", ageMin: 60, ageMax: null, sex: null },
    { label: "High", low: 41, high: null, unit: "ms", ageMin: 60, ageMax: null, sex: null },
  ],
  spo2: [
    { label: "Critical", low: null, high: 89, unit: "%", ageMin: null, ageMax: null, sex: null },
    { label: "Low / Hypoxemia", low: 90, high: 94, unit: "%", ageMin: null, ageMax: null, sex: null },
    { label: "Normal", low: 95, high: 100, unit: "%", ageMin: null, ageMax: null, sex: null },
  ],
  ahi: [
    { label: "Normal", low: null, high: 4.9, unit: "events/hr", ageMin: 18, ageMax: null, sex: null },
    { label: "Mild OSA", low: 5, high: 14.9, unit: "events/hr", ageMin: 18, ageMax: null, sex: null },
    { label: "Moderate OSA", low: 15, high: 29.9, unit: "events/hr", ageMin: 18, ageMax: null, sex: null },
    { label: "Severe OSA", low: 30, high: null, unit: "events/hr", ageMin: 18, ageMax: null, sex: null },
  ],
  sleep_duration: [
    { label: "Short sleep", low: null, high: 5.9, unit: "hours", ageMin: 18, ageMax: 64, sex: null },
    { label: "May be appropriate", low: 6, high: 6.9, unit: "hours", ageMin: 18, ageMax: 64, sex: null },
    { label: "Recommended", low: 7, high: 9, unit: "hours", ageMin: 18, ageMax: 64, sex: null },
    { label: "May be appropriate", low: 9.1, high: 10, unit: "hours", ageMin: 18, ageMax: 64, sex: null },
    { label: "Long sleep", low: 10.1, high: null, unit: "hours", ageMin: 18, ageMax: 64, sex: null },
    { label: "Short sleep", low: null, high: 4.9, unit: "hours", ageMin: 65, ageMax: null, sex: null },
    { label: "May be appropriate", low: 5, high: 6.9, unit: "hours", ageMin: 65, ageMax: null, sex: null },
    { label: "Recommended", low: 7, high: 8, unit: "hours", ageMin: 65, ageMax: null, sex: null },
    { label: "May be appropriate", low: 8.1, high: 9, unit: "hours", ageMin: 65, ageMax: null, sex: null },
    { label: "Long sleep", low: 9.1, high: null, unit: "hours", ageMin: 65, ageMax: null, sex: null },
    { label: "Recommended", low: 8, high: 10, unit: "hours", ageMin: 14, ageMax: 17, sex: null },
    { label: "Recommended", low: 9, high: 11, unit: "hours", ageMin: 6, ageMax: 13, sex: null },
  ],
  bp_systolic: [
    { label: "Normal", low: null, high: 119, unit: "mmHg", ageMin: 18, ageMax: null, sex: null },
    { label: "Elevated", low: 120, high: 129, unit: "mmHg", ageMin: 18, ageMax: null, sex: null },
    { label: "Hypertension Stage 1", low: 130, high: 139, unit: "mmHg", ageMin: 18, ageMax: null, sex: null },
    { label: "Hypertension Stage 2", low: 140, high: 179, unit: "mmHg", ageMin: 18, ageMax: null, sex: null },
    { label: "Hypertensive Crisis", low: 180, high: null, unit: "mmHg", ageMin: 18, ageMax: null, sex: null },
  ],
  bp_diastolic: [
    { label: "Normal", low: null, high: 79, unit: "mmHg", ageMin: 18, ageMax: null, sex: null },
    { label: "Hypertension Stage 1", low: 80, high: 89, unit: "mmHg", ageMin: 18, ageMax: null, sex: null },
    { label: "Hypertension Stage 2", low: 90, high: 119, unit: "mmHg", ageMin: 18, ageMax: null, sex: null },
    { label: "Hypertensive Crisis", low: 120, high: null, unit: "mmHg", ageMin: 18, ageMax: null, sex: null },
  ],
  body_temp: [
    { label: "Hypothermia", low: null, high: 95.9, unit: "°F", ageMin: null, ageMax: null, sex: null },
    { label: "Normal", low: 96.0, high: 99.0, unit: "°F", ageMin: null, ageMax: null, sex: null },
    { label: "Low-grade fever", low: 99.1, high: 100.3, unit: "°F", ageMin: null, ageMax: null, sex: null },
    { label: "Fever", low: 100.4, high: null, unit: "°F", ageMin: null, ageMax: null, sex: null },
  ],
  respiratory_rate: [
    { label: "Low", low: null, high: 11, unit: "breaths/min", ageMin: 18, ageMax: null, sex: null },
    { label: "Normal", low: 12, high: 20, unit: "breaths/min", ageMin: 18, ageMax: null, sex: null },
    { label: "High", low: 21, high: null, unit: "breaths/min", ageMin: 18, ageMax: null, sex: null },
  ],
};

/** Metric keys covered by the hardcoded fallback table (asserted ⊆ registry in tests). */
export const FALLBACK_RANGE_KEYS: readonly string[] = Object.keys(RANGES);

function matchesAge(entry: RangeEntry, age: number): boolean {
  if (entry.ageMin !== null && age < entry.ageMin) return false;
  if (entry.ageMax !== null && age > entry.ageMax) return false;
  return true;
}

function matchesSex(entry: RangeEntry, sex: "male" | "female" | "prefer_not_to_say"): boolean {
  if (entry.sex === null) return true;
  return entry.sex === sex;
}

/**
 * Look up the "Normal" / "Recommended" reference range for a vital metric
 * given the user's age and biological sex.
 *
 * Returns `null` when no matching range exists for the given parameters.
 */
export function getVitalRange(
  metricKey: string,
  age: number,
  sex: "male" | "female" | "prefer_not_to_say",
): VitalRange | null {
  const entries = RANGES[metricKey];
  if (!entries) return null;

  // Prefer "Normal" or "Recommended" labels that match age + sex.
  const normalLabels = ["Normal", "Recommended"];

  const match = entries.find(
    (e) =>
      normalLabels.includes(e.label) &&
      matchesAge(e, age) &&
      matchesSex(e, sex),
  );

  if (!match) return null;

  return {
    label: match.label,
    low: match.low ?? 0,
    high: match.high ?? Infinity,
    unit: match.unit,
  };
}
