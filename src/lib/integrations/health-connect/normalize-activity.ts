/**
 * daily_totals → vitals (PRD §6.6).
 *
 * Semantic: DAILY SNAPSHOT. The relay produced these with Health Connect's
 * aggregate API, which already deduplicates overlapping phone and watch
 * contributions, so the newest delivered snapshot REPLACES the day's four
 * metrics. Nothing here sums raw steps/distance/calorie intervals, and
 * nothing adds an incoming value to a stored one.
 *
 * The write goes through validateVitalWrite + upsertOwnVital directly, inside
 * the ingestion transaction — never an internal HTTP call to
 * /api/v1/vitals/batch (PRD §6.6). That keeps the closed metric registry, the
 * canonical units and the (metric, recorded_at, source) idempotency tuple
 * identical to every other vitals writer.
 */
import { VitalWriteError, upsertOwnVital, type VitalsWriteDb } from '@/lib/repos/vitals';
import { dailyTotalsSchema, type DailyTotalsEntry } from './schema';

/** Vitals `source` for every row written from a daily-totals snapshot. */
export const DAILY_TOTALS_SOURCE = 'health_connect_daily';

/** Meters per mile — `distance` is stored in miles (registry canonical unit). */
export const METERS_PER_MILE = 1609.344;

export function metersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}

/** Envelope field → registry metric. Only these four are approved. */
const METRIC_MAP: ReadonlyArray<{
  field: keyof DailyTotalsEntry;
  metricKey: string;
  unit: string;
  convert?: (value: number) => number;
}> = [
  { field: 'steps', metricKey: 'steps', unit: 'steps' },
  { field: 'distance_meters', metricKey: 'distance', unit: 'mi', convert: metersToMiles },
  { field: 'active_calories', metricKey: 'active_calories', unit: 'kcal' },
  { field: 'total_calories', metricKey: 'total_calories', unit: 'kcal' },
];

export interface ActivityNormalizationContext {
  integrationId: string;
  ingestId: string;
  appVersion: string | null;
}

export interface ActivityNormalizationResult {
  vitalsUpserted: number;
  errors: string[];
}

/**
 * Write one snapshot per supplied `daily_totals` entry. A metric absent from
 * an entry is UNKNOWN, not zero, so it produces no row at all — the day's
 * existing value for that metric is left untouched rather than zeroed.
 */
export function normalizeDailyTotals(
  dbh: VitalsWriteDb,
  userId: string,
  entries: unknown[],
  ctx: ActivityNormalizationContext,
): ActivityNormalizationResult {
  let vitalsUpserted = 0;
  const errors: string[] = [];

  for (const raw of entries) {
    const parsed = dailyTotalsSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`daily_totals: ${parsed.error.issues[0]?.message ?? 'invalid entry'}`);
      continue;
    }
    const entry = parsed.data;

    for (const m of METRIC_MAP) {
      const value = entry[m.field];
      if (typeof value !== 'number') continue;
      try {
        upsertOwnVital(dbh, userId, {
          metricKey: m.metricKey,
          value: m.convert ? m.convert(value) : value,
          unit: m.unit,
          source: DAILY_TOTALS_SOURCE,
          // The relay's aggregate day IS the intended calendar day; vitals
          // store non-intraday rows day-normalized in UTC, so the date maps
          // straight through without a timezone shift.
          recordedAt: `${entry.date}T00:00:00Z`,
          metadata: {
            health_connect_date: entry.date,
            app_version: ctx.appVersion,
            integration_id: ctx.integrationId,
            ingest_id: ctx.ingestId,
          },
        });
        vitalsUpserted += 1;
      } catch (error) {
        // Registry VALIDATION failures are per-metric and must not abort the
        // rest of the snapshot; the message is already API-safe. Anything
        // else (a database failure) propagates so the whole ingestion rolls
        // back rather than committing a half-normalized payload.
        if (!(error instanceof VitalWriteError)) throw error;
        errors.push(`daily_totals ${entry.date} ${m.metricKey}: ${error.message}`);
      }
    }
  }

  return { vitalsUpserted, errors };
}
