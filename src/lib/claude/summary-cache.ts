/** Shared patient-scoped facts feed both app queries and dashboard summaries. */
import { getHealthTrackTimeZone, calendarDayInTimeZone } from '@/lib/oura/timezone';
import { buildHealthContext, queryContextMetadata } from '@/lib/health-context';
import { resolveAiConfiguration, assertCurrentAiConfiguration } from '@/lib/ai/settings';
import { aiProvenance } from '@/lib/ai/types';
import {
  generateHealthSummary,
  type HealthSummary,
  type HealthSummaryInput,
} from './health-summary';
import { upsertCachedSummary } from '@/lib/repos/daily-summaries';
import { listActiveInteractionAlerts } from '@/lib/repos/interaction-alerts';
import { listGoals } from '@/lib/repos/goals';

export function ownerLocalDayKey(now = new Date()): string {
  return calendarDayInTimeZone(now, getHealthTrackTimeZone());
}
export const WELCOME_SUMMARY: HealthSummary = {
  summary:
    'Welcome! Start by adding your medications, conditions, or uploading lab results to get a personalized health overview.',
  highlights: [
    { type: 'action', text: 'Add your first health record to unlock AI-powered insights.' },
  ],
};
export function hasSummaryData(input: HealthSummaryInput): boolean {
  return (
    input.medications.length > 0 ||
    input.conditions.length > 0 ||
    input.recentLabFlags.length > 0 ||
    input.vitals.length > 0 ||
    !!input.recentWorkouts?.length ||
    !!input.nutritionContext
  );
}
export async function buildSummaryInputForUser(userId: string): Promise<HealthSummaryInput> {
  const [snapshot, alerts, goals] = await Promise.all([
    buildHealthContext(userId, null, 365),
    listActiveInteractionAlerts(userId, { ownerId: userId, dependentId: null }),
    listGoals(userId, userId, { active: true }),
  ]);
  const f = snapshot.facts;
  const contextMetadata = queryContextMetadata(snapshot);
  return {
    medications: f.medications
      .filter((m) => m.active === true)
      .map((m) => ({
        name: String(m.name),
        dosage: m.dosage as string | null,
        frequency: m.frequency as string | null,
        start_date: m.start_date as string | null,
        end_date: m.end_date as string | null,
      })),
    conditions: f.conditions.map((c) => ({ name: String(c.name) })),
    recentLabFlags: f.labs
      .filter((r) => ['high', 'low', 'critical'].includes(String(r.flag)))
      .slice(0, 30)
      .map((r) => ({
        test_name: String(r.test_name),
        value: r.value as number,
        unit: r.unit as string | null,
        flag: String(r.flag),
        reference_range_low: r.reference_range_low as number | null,
        reference_range_high: r.reference_range_high as number | null,
        visit_date: String(r.visit_date),
      })),
    vitals: f.vitals.map((v) => ({
      metric_key: v.metric_key,
      value: v.value,
      unit: v.unit ?? '',
      recorded_at: v.recorded_at,
    })),
    interactionAlerts: alerts.map((a) => ({ alert_text: a.alertText, severity: a.severity })),
    goals,
    recentWorkouts: f.fitness
      .filter((w) => new Date(w.started_at).getTime() >= Date.now() - 14 * 86400000)
      .map((w) => ({ type: w.type, label: w.label, startedAt: w.started_at })),
    nutritionContext: f.nutrition.length ? JSON.stringify(f.nutrition) : undefined,
    contextMetadata,
  };
}
export interface GenerateResult {
  summary: HealthSummary;
  cached: boolean;
}
export async function generateAndCacheSummary(
  userId: string,
  now = new Date()
): Promise<GenerateResult> {
  const config = resolveAiConfiguration(userId);
  const input = await buildSummaryInputForUser(userId);
  if (!hasSummaryData(input)) return { summary: WELCOME_SUMMARY, cached: false };
  const generated = await generateHealthSummary(input, config);
  assertCurrentAiConfiguration(config);
  const summary = {
    ...generated,
    contextMetadata: { ...input.contextMetadata!, ai: aiProvenance(config) },
  };
  await upsertCachedSummary(userId, ownerLocalDayKey(now), summary, config.primaryModel, config);
  return { summary, cached: true };
}
