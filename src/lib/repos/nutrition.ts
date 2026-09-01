/**
 * nutrition_daily repository — canonical daily actual intake.
 *
 * Authorization: owner-only (no share/delegate grants, no dependent column) —
 * the posture used by vital_source_preferences. Reads key on user_id directly.
 *
 * The canonical model is a DAILY SNAPSHOT: `overwriteNutritionDay` REPLACES
 * the row for (user, date, source_package) with freshly recomputed totals.
 * There is deliberately no "add to today's total" helper — webhook batches
 * overlap, retry and carry only changed records, so an additive path would
 * double count (PRD §6.7). Callers recompute the day from retained raw
 * records and hand the complete result here.
 *
 * Null vs zero is preserved end to end: a nutrient nobody reported stays NULL.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, type DB } from '@/db';
import { nutritionDaily } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';

export type NutritionDailyRow = typeof nutritionDaily.$inferSelect;

/** Same synchronous drizzle handle contract as VitalsWriteDb. */
export type NutritionWriteDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const dayKeySchema = z.string().regex(DAY_RE, 'date must be YYYY-MM-DD');

/** A fully recomputed day. Nutrients are `number | null` — never undefined,
    so an overwrite always states what is known AND what is unknown. */
export interface NutritionDayTotals {
  date: string;
  sourcePackage: string;
  calories: number | null;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  fiberGrams?: number | null;
  sugarGrams?: number | null;
  sodiumMilligrams?: number | null;
  recordCount: number;
  metadata?: Record<string, unknown>;
}

export type NutritionUpsertOutcome = 'inserted' | 'updated' | 'deleted' | 'noop';

/**
 * Replace the canonical row for (user, date, source_package) with `totals`.
 * Synchronous so it runs inside the ingestion transaction.
 *
 * When a recomputation finds no records left for the day (every record was
 * edited away), the row is DELETED rather than zeroed — zero calories is a
 * claim about the day, absence is not.
 */
export function overwriteNutritionDay(
  dbh: NutritionWriteDb,
  userId: string,
  totals: NutritionDayTotals,
): NutritionUpsertOutcome {
  dayKeySchema.parse(totals.date);
  const now = new Date().toISOString();
  const where = and(
    eq(nutritionDaily.userId, userId),
    eq(nutritionDaily.date, totals.date),
    eq(nutritionDaily.sourcePackage, totals.sourcePackage),
  );

  if (totals.recordCount === 0) {
    const removed = dbh.delete(nutritionDaily).where(where).run();
    return removed.changes > 0 ? 'deleted' : 'noop';
  }

  const values = {
    calories: totals.calories,
    proteinGrams: totals.proteinGrams,
    carbsGrams: totals.carbsGrams,
    fatGrams: totals.fatGrams,
    fiberGrams: totals.fiberGrams ?? null,
    sugarGrams: totals.sugarGrams ?? null,
    sodiumMilligrams: totals.sodiumMilligrams ?? null,
    recordCount: totals.recordCount,
    metadata: totals.metadata ?? {},
  };

  const updated = dbh
    .update(nutritionDaily)
    .set({ ...values, updatedAt: now })
    .where(where)
    .run();
  if (updated.changes > 0) return 'updated';

  dbh
    .insert(nutritionDaily)
    .values({
      userId,
      date: totals.date,
      sourcePackage: totals.sourcePackage,
      ...values,
    })
    .run();
  return 'inserted';
}

export interface ListNutritionOptions {
  /** Inclusive 'YYYY-MM-DD' lower bound. */
  startDate?: string;
  /** Inclusive 'YYYY-MM-DD' upper bound. */
  endDate?: string;
  sourcePackage?: string;
  limit?: number;
}

/**
 * The actor's canonical daily rows, oldest first (chart order). Normal reads
 * and charts use ONLY this table — never the raw webhook history (PRD §6.7).
 */
export async function listNutritionDaily(
  actorId: string,
  opts: ListNutritionOptions = {},
): Promise<NutritionDailyRow[]> {
  if (!actorId) throw new NotFoundError();
  if (opts.startDate) dayKeySchema.parse(opts.startDate);
  if (opts.endDate) dayKeySchema.parse(opts.endDate);
  const limit = Math.min(Math.max(1, opts.limit ?? 400), 1000);
  return db
    .select()
    .from(nutritionDaily)
    .where(
      and(
        eq(nutritionDaily.userId, actorId),
        opts.startDate ? gte(nutritionDaily.date, opts.startDate) : undefined,
        opts.endDate ? lte(nutritionDaily.date, opts.endDate) : undefined,
        opts.sourcePackage
          ? eq(nutritionDaily.sourcePackage, opts.sourcePackage)
          : undefined,
      ),
    )
    .orderBy(asc(nutritionDaily.date), asc(nutritionDaily.sourcePackage))
    .limit(limit);
}
