/**
 * dashboard_stat_preferences repository — strictly owner-only (006 had plain
 * `auth.uid() = user_id` policies; no share or delegate grants exist).
 *
 * getDashboardExtras also serves the two owner-scoped reads the dashboard
 * hook used to make directly (connected_sources count, latest lab test per
 * name). The lab read goes through the labs repo; connected_sources' own
 * domain (oura) converts in a later batch — the read here is owner-only by
 * construction.
 */
import { and, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { connectedSources, dashboardStatPreferences, dependents } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';
import { dependentFilter } from './_scope';
import { listLabResults } from './labs';

export type DashboardPrefRow = typeof dashboardStatPreferences.$inferSelect;

const prefInputSchema = z
  .object({
    widgetType: z.enum(['vital', 'lab_result']).default('vital'),
    metricKey: z.string().trim().min(1),
    position: z.number().int().default(0),
    pinned: z.boolean().default(false),
    visible: z.boolean().default(true),
  })
  .strip();

const prefUpdateSchema = z
  .object({
    position: z.number().int().optional(),
    pinned: z.boolean().optional(),
    visible: z.boolean().optional(),
  })
  .strip();

export type DashboardPrefInput = z.input<typeof prefInputSchema>;
export type DashboardPrefUpdate = z.infer<typeof prefUpdateSchema>;

/** Owner-only guard: the dependent (when given) must belong to the actor. */
async function requireOwnedScope(actorId: string, dependentId: string | null) {
  if (!actorId) throw new NotFoundError();
  if (dependentId === null) return;
  const rows = await db
    .select({ id: dependents.id })
    .from(dependents)
    .where(and(eq(dependents.id, dependentId), eq(dependents.parentUserId, actorId)))
    .limit(1);
  if (rows.length === 0) throw new NotFoundError();
}

export async function listDashboardPrefs(
  actorId: string,
  dependentId: string | null,
): Promise<DashboardPrefRow[]> {
  await requireOwnedScope(actorId, dependentId);
  return db
    .select()
    .from(dashboardStatPreferences)
    .where(
      and(
        eq(dashboardStatPreferences.userId, actorId),
        dependentFilter(dashboardStatPreferences.dependentId, dependentId),
      ),
    )
    .orderBy(asc(dashboardStatPreferences.position));
}

export async function createDashboardPrefs(
  actorId: string,
  dependentId: string | null,
  items: unknown,
): Promise<DashboardPrefRow[]> {
  await requireOwnedScope(actorId, dependentId);
  const parsed = z.array(prefInputSchema).min(1).parse(items);
  return db
    .insert(dashboardStatPreferences)
    .values(parsed.map((p) => ({ ...p, userId: actorId, dependentId })))
    .returning();
}

async function loadOwnedPref(actorId: string, id: string): Promise<DashboardPrefRow> {
  const rows = await db
    .select()
    .from(dashboardStatPreferences)
    .where(eq(dashboardStatPreferences.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.userId !== actorId) throw new NotFoundError();
  return row;
}

export async function updateDashboardPref(
  actorId: string,
  id: string,
  patch: unknown,
): Promise<DashboardPrefRow> {
  await loadOwnedPref(actorId, id);
  const values = prefUpdateSchema.parse(patch);
  const [row] = await db
    .update(dashboardStatPreferences)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(dashboardStatPreferences.id, id))
    .returning();
  return row;
}

export async function deleteDashboardPref(actorId: string, id: string): Promise<void> {
  await loadOwnedPref(actorId, id);
  await db.delete(dashboardStatPreferences).where(eq(dashboardStatPreferences.id, id));
}

export interface AvailableLabTest {
  testName: string;
  unit: string | null;
  latestValue: number;
  flag: string | null;
}

export interface DashboardExtras {
  sourceCount: number;
  availableLabTests: AvailableLabTest[];
}

export async function getDashboardExtras(actorId: string): Promise<DashboardExtras> {
  if (!actorId) throw new NotFoundError();
  const [{ n }] = await db
    .select({ n: count() })
    .from(connectedSources)
    .where(eq(connectedSources.userId, actorId));

  // Latest value per test name (hook parity: ordered by created_at desc,
  // deduped keeping the most recent, no dependent filter).
  const rows = await listLabResults(actorId, { ownerId: actorId, dependentId: 'all' });

  const seen = new Map<string, AvailableLabTest>();
  for (const row of rows) {
    if (!seen.has(row.testName)) {
      seen.set(row.testName, {
        testName: row.testName,
        unit: row.unit,
        latestValue: row.value,
        flag: row.flag,
      });
    }
  }

  return { sourceCount: n, availableLabTests: Array.from(seen.values()) };
}
