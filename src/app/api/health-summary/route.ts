import { NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED, getCapabilities } from '@/lib/capabilities';
import { safeError } from '@/lib/safe-log';
import { generateHealthSummary, type HealthSummaryInput } from '@/lib/claude/health-summary';
import { listMedications } from '@/lib/repos/medications';
import { listConditions } from '@/lib/repos/conditions';
import { listLabResults } from '@/lib/repos/labs';
import { listVitals } from '@/lib/repos/vitals';
import { listActiveInteractionAlerts } from '@/lib/repos/interaction-alerts';

export async function GET() {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return apiError(401, 'unauthorized', 'Authentication required');
    }
    throw err;
  }

  // Gated after auth so unauthenticated callers can't probe instance config.
  if (!getCapabilities().ai) {
    return apiError(501, AI_NOT_CONFIGURED, AI_NOT_CONFIGURED);
  }

  try {
    // Only consider data from the last 12 months for the summary
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const cutoffISO = cutoff.toISOString();

    // Vitals use a 30-day window with a high row cap so the per-metric
    // aggregates (7d/30d averages, trends) are computed over real data.
    const vitalsCutoff = new Date();
    vitalsCutoff.setDate(vitalsCutoff.getDate() - 30);
    const vitalsCutoffISO = vitalsCutoff.toISOString();

    // The legacy queries filtered on user_id only — scope 'all' preserves that.
    const scope = { ownerId: userId, dependentId: 'all' as const };
    // VITALS are the exception: aggregates present per-metric stats as ONE
    // person's trends, so blending a dependent's readings into the owner's
    // averages would be clinically wrong. Owner rows only (dependent IS NULL).
    const ownVitalsScope = { ownerId: userId, dependentId: null };

    const [meds, conditions, allLabResults, vitals, alerts] = await Promise.all([
      listMedications(userId, scope, { active: true }),
      listConditions(userId, scope),
      // flagged results in the last year, created_at desc, limit 10 —
      // filtered below (repo returns created_at desc already)
      listLabResults(userId, scope),
      listVitals(userId, ownVitalsScope, { startDate: vitalsCutoffISO, limit: 2000 }),
      listActiveInteractionAlerts(userId, scope),
    ]);

    const recentLabFlags = allLabResults
      .filter(
        (r) =>
          r.flag !== null &&
          ['high', 'low', 'critical'].includes(r.flag) &&
          r.createdAt >= cutoffISO,
      )
      .slice(0, 10);

    const input: HealthSummaryInput = {
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
    };

    // Skip AI call if there's essentially no data to summarize
    const hasData =
      input.medications.length > 0 ||
      input.conditions.length > 0 ||
      input.recentLabFlags.length > 0 ||
      input.vitals.length > 0;

    if (!hasData) {
      return NextResponse.json({
        summary:
          'Welcome! Start by adding your medications, conditions, or uploading lab results to get a personalized health overview.',
        highlights: [
          {
            type: 'action' as const,
            text: 'Add your first health record to unlock AI-powered insights.',
          },
        ],
      });
    }

    const summary = await generateHealthSummary(input);
    return NextResponse.json(summary);
  } catch (err) {
    safeError('Health summary error', err);
    return apiError(500, 'internal_error', 'Failed to generate health summary');
  }
}
