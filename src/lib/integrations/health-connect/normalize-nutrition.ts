/**
 * nutrition → nutrition_daily (PRD §6.7).
 *
 * Semantic: DAILY AGGREGATE producing a DAILY SNAPSHOT row. For every Phoenix
 * date this batch touched, the whole day is recomputed from the RETAINED
 * DEDUPLICATED raw records — not from the newest webhook batch — and the
 * canonical row for (user, date, source_package) is overwritten.
 *
 * The rule that makes retries, overlapping batches and MacroFactor edits safe:
 * an incoming subtotal is NEVER added to the previously stored total. Food
 * logged later in the day updates the same row; the first record after the
 * Phoenix date rolls over creates a fresh row for the new day; a record edited
 * across midnight recomputes BOTH days.
 *
 * Two shapes are supported because MacroFactor's real record shape is only
 * known after inventory (integration.nutritionStrategy):
 *   'aggregate'      — sum every deduplicated record for the day. Correct for
 *                      food/meal records, and also correct when the source
 *                      emits a single daily-summary record.
 *   'daily_snapshot' — take only the newest record for the day. Used when the
 *                      source emits one mutable daily summary ALONGSIDE item
 *                      records, where summing both would double count.
 *
 * Null vs zero survives: a nutrient no record reported stays null.
 */
import { dayKeyInTz } from '@/lib/fitness/weeks';
import { OWNER_TZ } from '@/lib/fitness/rollup';
import {
  listRawRecordsInWindow,
  type HcWriteDb,
  type HealthConnectRawRecordRow,
} from '@/lib/repos/health-connect';
import {
  overwriteNutritionDay,
  type NutritionWriteDb,
} from '@/lib/repos/nutrition';
import type { NutritionStrategy } from '@/db/schema';
import { nutritionRecordSchema } from './schema';

/** Nutrient fields carried by the pinned relay schema, wire → column. */
const NUTRIENTS = [
  { wire: 'calories', column: 'calories' },
  { wire: 'protein_grams', column: 'proteinGrams' },
  { wire: 'carbs_grams', column: 'carbsGrams' },
  { wire: 'fat_grams', column: 'fatGrams' },
] as const;

type NutrientColumn = (typeof NUTRIENTS)[number]['column'];

/** Owner-local calendar date for an instant (America/Phoenix, no DST). */
export function phoenixDate(instant: string): string | null {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return dayKeyInTz(d, OWNER_TZ);
}

/**
 * UTC instant bounds that cover a whole Phoenix calendar day. Phoenix is a
 * fixed UTC-7 (MST, never observes DST), so the day runs [date 07:00Z,
 * date+1 07:00Z). The upper bound is returned INCLUSIVE-of-instant minus a
 * millisecond so it can be used with a <= comparison on ISO strings.
 */
export function phoenixDayWindow(date: string): { startAt: string; endAt: string } {
  const startMs = new Date(`${date}T00:00:00Z`).getTime() + 7 * 60 * 60 * 1000;
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;
  return {
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
  };
}

export interface NutritionNormalizationContext {
  integrationId: string;
  ingestId: string;
  appVersion: string | null;
  /** Exact approved package names — matching is exact, never substring. */
  allowedPackages: string[];
  strategy: NutritionStrategy;
}

export interface NutritionNormalizationResult {
  daysUpserted: number;
  errors: string[];
}

/**
 * Recompute and overwrite every affected Phoenix day.
 *
 * `affectedDates` is computed by the caller from this batch's records PLUS
 * the previous dates of records that moved in time, so an edit that crosses
 * midnight fixes both the day it left and the day it joined.
 */
export function normalizeNutritionDays(
  dbh: HcWriteDb & NutritionWriteDb,
  userId: string,
  affectedDates: Iterable<string>,
  ctx: NutritionNormalizationContext,
): NutritionNormalizationResult {
  let daysUpserted = 0;
  const errors: string[] = [];

  // No try/catch here on purpose: the only things that can throw are database
  // failures, and those MUST roll the whole ingestion back rather than being
  // reported as a soft per-day error (PRD §10 transaction tests). Per-record
  // shape problems are already handled by computeDayTotals, which simply
  // ignores payloads that do not parse as nutrition records.
  for (const pkg of ctx.allowedPackages) {
    for (const date of affectedDates) {
      const { startAt, endAt } = phoenixDayWindow(date);
      const rows = listRawRecordsInWindow(dbh, userId, 'nutrition', startAt, endAt, [pkg]);
      // The window is an instant range; re-check the calendar date so a
      // record on the boundary is attributed to exactly one Phoenix day.
      const forDay = rows.filter(
        (r) => r.recordedStartAt && phoenixDate(r.recordedStartAt) === date,
      );
      const totals = computeDayTotals(forDay, ctx.strategy);
      const outcome = overwriteNutritionDay(dbh, userId, {
        date,
        sourcePackage: pkg,
        ...totals,
        metadata: {
          strategy: ctx.strategy,
          timezone: OWNER_TZ,
          integration_id: ctx.integrationId,
          ingest_id: ctx.ingestId,
          app_version: ctx.appVersion,
        },
      });
      if (outcome !== 'noop') daysUpserted += 1;
    }
  }

  return { daysUpserted, errors };
}

/**
 * Collapse a day's retained records into one canonical set of totals.
 * A nutrient is null unless at least one contributing record reported it.
 */
export function computeDayTotals(
  rows: HealthConnectRawRecordRow[],
  strategy: NutritionStrategy,
): {
  calories: number | null;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  recordCount: number;
} {
  const parsed = rows
    .map((r) => nutritionRecordSchema.safeParse(r.payload))
    .filter((p) => p.success)
    .map((p) => p.data);

  const contributing =
    strategy === 'daily_snapshot' ? pickLatest(parsed) : parsed;

  const sums: Record<NutrientColumn, number | null> = {
    calories: null,
    proteinGrams: null,
    carbsGrams: null,
    fatGrams: null,
  };

  for (const record of contributing) {
    for (const n of NUTRIENTS) {
      const value = (record as Record<string, unknown>)[n.wire];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      sums[n.column] = (sums[n.column] ?? 0) + value;
    }
  }

  // Float addition of one-decimal macro values accumulates noise
  // (0.1 + 0.2 = 0.30000000000000004); round to a tenth of a gram/kcal, which
  // is finer than any source reports.
  for (const n of NUTRIENTS) {
    const v = sums[n.column];
    if (v !== null) sums[n.column] = Math.round(v * 10) / 10;
  }

  return { ...sums, recordCount: contributing.length };
}

/** The newest record of the day by start_time (ties → the last one seen). */
function pickLatest<T extends { start_time: string }>(records: T[]): T[] {
  if (records.length === 0) return [];
  let latest = records[0];
  for (const r of records.slice(1)) {
    if (new Date(r.start_time).getTime() >= new Date(latest.start_time).getTime()) {
      latest = r;
    }
  }
  return [latest];
}
