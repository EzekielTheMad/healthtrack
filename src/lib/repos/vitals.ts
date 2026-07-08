/**
 * vitals repository (vitals + vital_reference_ranges + vital_source_preferences).
 *
 * Authorization (003/012/014, encoded in src/lib/authz):
 *   vitals — standard matrix: owner full; shares READ-ONLY with section
 *     'vitals' + exact dependent match; delegates read (read_only+),
 *     insert/update (read_write+), delete (admin).
 *   vital_reference_ranges — world-readable seed data ("using (true)" in 003);
 *     no writes from the app.
 *   vital_source_preferences — strictly owner-only (`auth.uid() = user_id`
 *     policies in 003; no share/delegate grants, no dependent column).
 */
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { vitals, vitalReferenceRanges, vitalSourcePreferences } from '@/db/schema';
import { requireAuthz } from '@/lib/authz';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type VitalRow = typeof vitals.$inferSelect;
export type VitalReferenceRangeRow = typeof vitalReferenceRanges.$inferSelect;
export type VitalSourcePreferenceRow = typeof vitalSourcePreferences.$inferSelect;

// Unknown keys (id, user_id, dependent_id, created_at…) are stripped —
// row scope is never client-controlled.
const vitalInputSchema = z
  .object({
    metricKey: z.string().trim().min(1),
    value: z.number(),
    unit: z.string().nullish(),
    source: z.string().trim().min(1),
    recordedAt: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strip();

export type VitalInput = z.input<typeof vitalInputSchema>;

export interface ListVitalsOptions {
  /** Inclusive recorded_at lower bound (ISO string). */
  startDate?: string;
  /** Inclusive recorded_at upper bound (ISO string). */
  endDate?: string;
  /** Exact metric filter (v1 API `?metric=`). */
  metricKey?: string;
  /** Row cap (v1 API `?limit=`). */
  limit?: number;
}

export async function listVitals(
  actorId: string,
  scope: ListScope,
  opts: ListVitalsOptions = {},
): Promise<VitalRow[]> {
  await requireListAuthz(actorId, scope, 'vitals', 'read');
  const query = db
    .select()
    .from(vitals)
    .where(
      and(
        eq(vitals.userId, scope.ownerId),
        dependentFilter(vitals.dependentId, scope.dependentId),
        opts.metricKey ? eq(vitals.metricKey, opts.metricKey) : undefined,
        opts.startDate ? gte(vitals.recordedAt, opts.startDate) : undefined,
        opts.endDate ? lte(vitals.recordedAt, opts.endDate) : undefined,
      ),
    )
    .orderBy(desc(vitals.recordedAt));
  return opts.limit !== undefined ? query.limit(opts.limit) : query;
}

export async function createVital(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<VitalRow> {
  await requireAuthz(actorId, scope, 'vitals', 'write');
  const values = vitalInputSchema.parse(input);
  const [row] = await db
    .insert(vitals)
    .values({ ...values, userId: scope.ownerId, dependentId: scope.dependentId })
    .returning();
  return row;
}

/** World-readable reference ranges (seeded from 002) — no authz by design. */
export async function listVitalReferenceRanges(): Promise<VitalReferenceRangeRow[]> {
  return db
    .select()
    .from(vitalReferenceRanges)
    .orderBy(asc(vitalReferenceRanges.metricKey), asc(vitalReferenceRanges.rangeLow));
}

/** Owner-only: the actor's own source preferences. */
export async function listVitalSourcePreferences(
  actorId: string,
): Promise<VitalSourcePreferenceRow[]> {
  return db
    .select()
    .from(vitalSourcePreferences)
    .where(eq(vitalSourcePreferences.userId, actorId))
    .orderBy(asc(vitalSourcePreferences.metricKey));
}

/** Owner-only upsert keyed by the (user_id, metric_key) unique constraint. */
export async function setVitalSourcePreference(
  actorId: string,
  metricKey: string,
  preferredSource: string,
): Promise<VitalSourcePreferenceRow> {
  const values = z
    .object({
      metricKey: z.string().trim().min(1),
      preferredSource: z.string().trim().min(1),
    })
    .parse({ metricKey, preferredSource });
  const [row] = await db
    .insert(vitalSourcePreferences)
    .values({ ...values, userId: actorId })
    .onConflictDoUpdate({
      target: [vitalSourcePreferences.userId, vitalSourcePreferences.metricKey],
      set: { preferredSource: values.preferredSource },
    })
    .returning();
  return row;
}
