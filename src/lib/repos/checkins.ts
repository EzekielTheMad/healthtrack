/**
 * weekly check-ins repository.
 *
 * Authorization: 'fitness' section (owner full; delegates read-only; not
 * shareable). Check-ins are strictly per-user (no dependent column).
 *
 * Spec (§weekly_checkins): manual fields only, keyed by week_start — a
 * Monday YYYY-MM-DD, unique per user. neck_in / waist_in are ACCEPTED by the
 * upsert but never stored on the row: they write through to the vitals table
 * (metric 'neck' / 'waist', source 'manual', recorded on the submission day)
 * so rollups read them back from vitals like every other body measurement.
 *
 * PUT semantics: the upsert replaces ALL manual fields — omitted fields are
 * cleared to null, matching `PUT /checkins/{weekStart}`.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { weeklyCheckins } from '@/db/schema';
import { requireAuthz } from '@/lib/authz';
import { upsertOwnVital } from './vitals';
import { parseFitness, validateWeekStart } from './_fitness';

export type WeeklyCheckinRow = typeof weeklyCheckins.$inferSelect;

// Unknown keys (id, user_id, week_start, timestamps…) are stripped — row
// scope and the week key are never taken from the body.
const checkinInputSchema = z
  .object({
    working: z.string().max(5000).nullish(),
    notWorking: z.string().max(5000).nullish(),
    daysLogged: z.number().int().min(0).max(7).nullish(),
    avgCalories: z.number().positive().finite().nullish(),
    avgProteinG: z.number().positive().finite().nullish(),
    avgCarbsG: z.number().positive().finite().nullish(),
    avgFatG: z.number().positive().finite().nullish(),
    avgFiberG: z.number().positive().finite().nullish(),
    // Write-through to vitals — never stored on the check-in row.
    neckIn: z.number().positive().finite().optional(),
    waistIn: z.number().positive().finite().optional(),
  })
  .strip();

export type WeeklyCheckinInput = z.input<typeof checkinInputSchema>;

export async function getCheckin(
  actorId: string,
  ownerId: string,
  weekStart: string,
): Promise<WeeklyCheckinRow | null> {
  await requireAuthz(actorId, { ownerId, dependentId: null }, 'fitness', 'read');
  validateWeekStart(weekStart);
  const rows = await db
    .select()
    .from(weeklyCheckins)
    .where(and(eq(weeklyCheckins.userId, ownerId), eq(weeklyCheckins.weekStart, weekStart)))
    .limit(1);
  return rows[0] ?? null;
}

export interface ListCheckinsOptions {
  /** Inclusive week_start lower bound (YYYY-MM-DD). */
  from?: string;
  /** Inclusive week_start upper bound (YYYY-MM-DD). */
  to?: string;
  limit?: number;
}

export async function listCheckins(
  actorId: string,
  ownerId: string,
  opts: ListCheckinsOptions = {},
): Promise<WeeklyCheckinRow[]> {
  await requireAuthz(actorId, { ownerId, dependentId: null }, 'fitness', 'read');
  const query = db
    .select()
    .from(weeklyCheckins)
    .where(
      and(
        eq(weeklyCheckins.userId, ownerId),
        opts.from ? gte(weeklyCheckins.weekStart, opts.from) : undefined,
        opts.to ? lte(weeklyCheckins.weekStart, opts.to) : undefined,
      ),
    )
    .orderBy(desc(weeklyCheckins.weekStart));
  return opts.limit !== undefined ? query.limit(opts.limit) : query;
}

/**
 * PUT /checkins/{weekStart}: validate the Monday key, replace the manual
 * fields (insert or full update), and forward neck_in/waist_in to the vitals
 * repo as manual-source rows recorded on the submission day. The vitals
 * write is idempotent per (metric, day, source) — re-submitting a check-in
 * the same day updates the measurement in place.
 */
export async function upsertCheckin(
  actorId: string,
  ownerId: string,
  weekStart: string,
  input: unknown,
): Promise<WeeklyCheckinRow> {
  await requireAuthz(actorId, { ownerId, dependentId: null }, 'fitness', 'write');
  validateWeekStart(weekStart);
  const { neckIn, waistIn, ...fields } = parseFitness(checkinInputSchema, input, 'check-in');

  // Write-through BEFORE the row upsert so a vitals validation failure (e.g.
  // registry bounds) rejects the whole submission.
  const recordedAt = new Date().toISOString();
  for (const [metricKey, value] of [
    ['neck', neckIn],
    ['waist', waistIn],
  ] as const) {
    if (value !== undefined) {
      upsertOwnVital(db, ownerId, { metricKey, value, source: 'manual', recordedAt });
    }
  }

  const values = {
    working: fields.working ?? null,
    notWorking: fields.notWorking ?? null,
    daysLogged: fields.daysLogged ?? null,
    avgCalories: fields.avgCalories ?? null,
    avgProteinG: fields.avgProteinG ?? null,
    avgCarbsG: fields.avgCarbsG ?? null,
    avgFatG: fields.avgFatG ?? null,
    avgFiberG: fields.avgFiberG ?? null,
  };
  const [row] = await db
    .insert(weeklyCheckins)
    .values({ ...values, userId: ownerId, weekStart })
    .onConflictDoUpdate({
      target: [weeklyCheckins.userId, weeklyCheckins.weekStart],
      set: { ...values, updatedAt: new Date().toISOString() },
    })
    .returning();
  return row;
}
