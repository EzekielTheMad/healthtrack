/**
 * nutrition → nutrition_daily: the PURE half (PRD §6.7).
 *
 * Semantic: DAILY AGGREGATE producing a DAILY SNAPSHOT row. This module owns
 * the Phoenix calendar arithmetic and the collapse of a day's retained
 * records into one canonical set of totals. The database-facing rebuild that
 * uses it lives in ./rebuild-nutrition.ts, so the webhook and the Settings
 * "Reprocess retained nutrition" action share one implementation.
 *
 * The rule that makes retries, overlapping batches and MacroFactor edits safe:
 * an incoming subtotal is NEVER added to the previously stored total. The day
 * is recomputed from the RETAINED DEDUPLICATED raw records and the canonical
 * row is overwritten.
 *
 * Two shapes are supported (integration.nutritionStrategy):
 *   'sum_items'      — sum every deduplicated record for the day. Correct for
 *                      food/meal records, and also correct when the source
 *                      emits a single daily-summary record. MacroFactor
 *                      (com.sbs.diet) emits individual items with stable
 *                      UUIDs, so this is its strategy.
 *   'latest_summary' — take only the newest record for the day. Used when the
 *                      source emits one mutable daily summary ALONGSIDE item
 *                      records, where summing both would double count.
 *
 * Null vs zero survives: a nutrient no record reported stays null.
 */
import { dayKeyInTz } from '@/lib/fitness/weeks';
import { OWNER_TZ } from '@/lib/fitness/rollup';
import type { HealthConnectRawRecordRow } from '@/lib/repos/health-connect';
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

/**
 * Decimals kept when summing. Health Connect hands the relay IEEE-754
 * doubles, so adding sixteen of them accumulates representation noise
 * (0.1 + 0.2 = 0.30000000000000004). Six decimals is far finer than any food
 * database resolves and far coarser than that noise, so it erases the
 * artefact without rounding away real precision. Display rounding is the UI's
 * job — the store keeps what the source said.
 */
const SUM_DECIMALS = 6;
const SUM_SCALE = 10 ** SUM_DECIMALS;

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

export interface NutritionDayComputation {
  calories: number | null;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  /** Records that actually contributed — the value stored as record_count. */
  recordCount: number;
}

/**
 * Collapse a day's retained records into one canonical set of totals.
 * A nutrient is null unless at least one contributing record reported it.
 *
 * Records whose payload does not parse as a nutrition record are ignored
 * rather than throwing: one malformed retained record must never discard the
 * day's valid ones. They are visible to the caller as the difference between
 * the input length and `recordCount`.
 */
export function computeDayTotals(
  rows: HealthConnectRawRecordRow[],
  strategy: NutritionStrategy,
): NutritionDayComputation {
  const parsed = rows
    .map((r) => nutritionRecordSchema.safeParse(r.payload))
    .filter((p) => p.success)
    .map((p) => p.data);

  const contributing = strategy === 'latest_summary' ? pickLatest(parsed) : parsed;

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

  for (const n of NUTRIENTS) {
    const v = sums[n.column];
    if (v !== null) sums[n.column] = Math.round(v * SUM_SCALE) / SUM_SCALE;
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
