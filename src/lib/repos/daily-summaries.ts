/**
 * daily_summaries repository — precomputed cache for the dashboard AI Health
 * Overview (one serialized HealthSummary per owner per owner-local day).
 *
 * Strictly owner-only (same posture as ai_lab_warning_dismissals /
 * dashboard_stat_preferences): the summary is the owner's own dashboard card;
 * there is no dependent, share, or delegate surface. Callers pass the session
 * user's id (or the PAT owner's id for the cron refresh endpoint).
 *
 * summary_json stores the RAW HealthSummary (with lab provenance attached) —
 * dismiss-until-new-labs filtering is applied by the read path at request
 * time, never persisted, so dismissals stay live without regeneration.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { dailySummaries } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';
import type { HealthSummary } from '@/lib/claude/health-summary';

export type DailySummaryRow = typeof dailySummaries.$inferSelect;

/** Parse a stored row's summary_json back into a HealthSummary. */
export function parseCachedSummary(row: DailySummaryRow): HealthSummary {
  const parsed = JSON.parse(row.summaryJson) as HealthSummary;
  return {
    summary: parsed.summary,
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
  };
}

/** The cached summary row for a specific owner-local day, or null. */
export async function getCachedSummary(
  userId: string,
  date: string,
): Promise<DailySummaryRow | null> {
  if (!userId) throw new NotFoundError();
  const rows = await db
    .select()
    .from(dailySummaries)
    .where(and(eq(dailySummaries.userId, userId), eq(dailySummaries.summaryDate, date)))
    .limit(1);
  return rows[0] ?? null;
}

/** The most recent cached summary for the owner (any day), or null. */
export async function getLatestCachedSummary(
  userId: string,
): Promise<DailySummaryRow | null> {
  if (!userId) throw new NotFoundError();
  const rows = await db
    .select()
    .from(dailySummaries)
    .where(eq(dailySummaries.userId, userId))
    .orderBy(desc(dailySummaries.summaryDate))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Insert or refresh the cache row for (user, date). Only ever called with a
 * freshly generated summary — a failed generation must never reach here, so a
 * good cached row is never overwritten with garbage.
 */
export async function upsertCachedSummary(
  userId: string,
  date: string,
  summary: HealthSummary,
  model: string,
): Promise<DailySummaryRow> {
  if (!userId) throw new NotFoundError();
  const generatedAt = new Date().toISOString();
  const summaryJson = JSON.stringify(summary);
  const [row] = await db
    .insert(dailySummaries)
    .values({ userId, summaryDate: date, summaryJson, generatedAt, model })
    .onConflictDoUpdate({
      target: [dailySummaries.userId, dailySummaries.summaryDate],
      set: { summaryJson, generatedAt, model },
    })
    .returning();
  return row;
}
