/**
 * Health-summary generation + daily caching service.
 *
 * The dashboard AI Health Overview is expensive (a reasoning-model call over
 * the owner's full snapshot). Instead of regenerating on every dashboard load,
 * we cache one serialized HealthSummary per owner per LOCAL day and serve it
 * instantly (see src/lib/repos/daily-summaries.ts + the GET route). This module
 * owns:
 *   - buildSummaryInputForUser: the snapshot assembly (moved verbatim from the
 *     GET route so the read path, the background refresh, and the cron endpoint
 *     all build the exact same input).
 *   - generateAndCacheSummary: build → generate → upsert today's cache row.
 *
 * Owner-local day key: the app has no per-user timezone column, so we reuse the
 * fitness domain's owner convention (America/Phoenix, MST, no DST) and the
 * timezone-aware day-key helper — never a raw UTC date, which would roll the
 * "day" over seven hours early for the owner.
 */
import { dayKeyInTz } from '@/lib/fitness/weeks';
import { OWNER_TZ } from '@/lib/fitness/rollup';
import { reasoningModel } from './model';
import {
  generateHealthSummary,
  type HealthSummary,
  type HealthSummaryInput,
} from './health-summary';
import { upsertCachedSummary } from '@/lib/repos/daily-summaries';
import { listMedications } from '@/lib/repos/medications';
import { listConditions } from '@/lib/repos/conditions';
import { listLabResults } from '@/lib/repos/labs';
import { listVitals } from '@/lib/repos/vitals';
import { listActiveInteractionAlerts } from '@/lib/repos/interaction-alerts';
import { listGoals } from '@/lib/repos/goals';
import { listWorkouts } from '@/lib/repos/workouts';

/** Owner-local calendar day (`YYYY-MM-DD`) for `now` (America/Phoenix). */
export function ownerLocalDayKey(now: Date = new Date()): string {
  return dayKeyInTz(now, OWNER_TZ);
}

/**
 * The welcome message shown (and never cached) when the owner has no data
 * worth summarizing yet — identical to the legacy no-data branch so behavior
 * is unchanged for a brand-new instance.
 */
export const WELCOME_SUMMARY: HealthSummary = {
  summary:
    'Welcome! Start by adding your medications, conditions, or uploading lab results to get a personalized health overview.',
  highlights: [
    {
      type: 'action',
      text: 'Add your first health record to unlock AI-powered insights.',
    },
  ],
};

/** Whether an assembled snapshot has anything worth sending to the model. */
export function hasSummaryData(input: HealthSummaryInput): boolean {
  return (
    input.medications.length > 0 ||
    input.conditions.length > 0 ||
    input.recentLabFlags.length > 0 ||
    input.vitals.length > 0
  );
}

/**
 * Assemble the model input snapshot for a user — the owner's meds, conditions,
 * flagged labs, 30-day vitals, active goals, recent training, and interaction
 * alerts. Scoping notes (unchanged from the legacy route):
 *   - Most domains use the legacy user-only scope ('all') to preserve the
 *     original behavior.
 *   - VITALS and fitness are owner-only (dependent_id NULL): per-metric
 *     aggregates present ONE person's trends, so a dependent's rows must never
 *     blend into the owner's averages.
 */
export async function buildSummaryInputForUser(
  userId: string,
): Promise<HealthSummaryInput> {
  // Only consider data from the last 12 months for the summary.
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffISO = cutoff.toISOString();

  // Vitals use a 30-day window with a high row cap so the per-metric
  // aggregates (7d/30d averages, trends) are computed over real data.
  const vitalsCutoff = new Date();
  vitalsCutoff.setDate(vitalsCutoff.getDate() - 30);
  const vitalsCutoffISO = vitalsCutoff.toISOString();

  // Recent-training block covers the trailing 14 days (spec §AI #1).
  const workoutsCutoff = new Date();
  workoutsCutoff.setDate(workoutsCutoff.getDate() - 14);
  const workoutsCutoffISO = workoutsCutoff.toISOString();

  // The legacy queries filtered on user_id only — scope 'all' preserves that.
  const scope = { ownerId: userId, dependentId: 'all' as const };
  // VITALS are the exception: aggregates present per-metric stats as ONE
  // person's trends, so blending a dependent's readings into the owner's
  // averages would be clinically wrong. Owner rows only (dependent IS NULL).
  const ownVitalsScope = { ownerId: userId, dependentId: null };

  const [meds, conditions, allLabResults, vitals, alerts, activeGoals, recentWorkouts] =
    await Promise.all([
      listMedications(userId, scope, { active: true }),
      listConditions(userId, scope),
      listLabResults(userId, scope),
      listVitals(userId, ownVitalsScope, { startDate: vitalsCutoffISO, limit: 2000 }),
      listActiveInteractionAlerts(userId, scope),
      // Fitness context is owner-scoped like the vitals aggregates: goals are
      // strictly per-user, and sessions read owner rows only.
      listGoals(userId, userId, { active: true }),
      listWorkouts(userId, ownVitalsScope, { from: workoutsCutoffISO }),
    ]);

  const recentLabFlags = allLabResults
    .filter(
      (r) =>
        r.flag !== null &&
        ['high', 'low', 'critical'].includes(r.flag) &&
        r.createdAt >= cutoffISO,
    )
    .slice(0, 10);

  return {
    medications: meds.map((m) => ({
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
    })),
    conditions: conditions.map((c) => ({ name: c.name })),
    recentLabFlags: recentLabFlags.map((r) => ({
      test_name: r.testName,
      value: r.value,
      unit: r.unit,
      flag: r.flag ?? 'normal',
      reference_range_low: r.referenceRangeLow,
      reference_range_high: r.referenceRangeHigh,
      visit_date: r.visitDate,
    })),
    vitals: vitals.map((v) => ({
      metric_key: v.metricKey,
      value: v.value,
      unit: v.unit ?? '',
      recorded_at: v.recordedAt,
      metadata: v.metadata,
    })),
    interactionAlerts: alerts.map((a) => ({
      alert_text: a.alertText,
      severity: a.severity,
    })),
    goals: activeGoals.map((g) => ({
      kind: g.kind,
      metricKey: g.metricKey,
      direction: g.direction,
      targetValue: g.targetValue,
      targetDate: g.targetDate,
      sessionType: g.sessionType,
      perWeek: g.perWeek,
    })),
    recentWorkouts: recentWorkouts.map((w) => ({
      type: w.type,
      label: w.label,
      startedAt: w.startedAt,
    })),
  };
}

export interface GenerateResult {
  /** The RAW summary (lab provenance attached, dismissals NOT yet filtered). */
  summary: HealthSummary;
  /** Whether it was written to the daily cache (false for the no-data welcome). */
  cached: boolean;
}

/**
 * Build the owner's snapshot, generate the summary, and upsert today's cache
 * row. Returns the RAW summary (the read path applies dismiss-until-new-labs
 * filtering). When there is no data to summarize, returns the welcome message
 * WITHOUT caching it — otherwise a later data import would be masked by a stale
 * "welcome" row for the rest of the day.
 *
 * If generation throws, the error propagates and NOTHING is written — a good
 * cached row from a previous run is never clobbered.
 */
export async function generateAndCacheSummary(
  userId: string,
  now: Date = new Date(),
): Promise<GenerateResult> {
  const input = await buildSummaryInputForUser(userId);
  if (!hasSummaryData(input)) {
    return { summary: WELCOME_SUMMARY, cached: false };
  }
  const summary = await generateHealthSummary(input);
  await upsertCachedSummary(userId, ownerLocalDayKey(now), summary, reasoningModel());
  return { summary, cached: true };
}
