import { NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED, getCapabilities } from '@/lib/capabilities';
import { safeError } from '@/lib/safe-log';
import { AI_DISCLAIMER } from '@/lib/ai-disclaimer';
import { queryHealthData } from '@/lib/claude/query';
import type { HealthContext } from '@/lib/claude/query';
import {
  aggregateVitals,
  formatAggregatesForPrompt,
  formatIntradayReadings,
} from '@/lib/metrics/aggregate';
import {
  formatGoalsForPrompt,
  formatRecentTrainingForPrompt,
} from '@/lib/claude/fitness-context';
import { listGoals } from '@/lib/repos/goals';
import { listWorkouts } from '@/lib/repos/workouts';
import { getProfile } from '@/lib/repos/profiles';
import { listMedications } from '@/lib/repos/medications';
import { listLabVisitsWithResults } from '@/lib/repos/labs';
import { listVitals } from '@/lib/repos/vitals';
import { listConditions } from '@/lib/repos/conditions';
import { listNotes } from '@/lib/repos/notes';
import { listAppointments } from '@/lib/repos/appointments';
import { createQueryHistoryEntry } from '@/lib/repos/query-history';
import type { QueryHistoryEntry } from '@/lib/types';

// ---------------------------------------------------------------------------
// Simple in-memory rate limiter: max 30 queries per user per hour.
// Note: this is per-instance, not a true global limit — accept that floor
// over no limit at all. A future improvement would use a shared store.
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_TRACKED_USERS = 5000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(userId) ?? [];

  // Remove entries older than the window
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, recent);
    return false;
  }

  recent.push(now);
  rateLimitMap.set(userId, recent);

  // Opportunistic cleanup so the map can't grow without bound in long-lived
  // processes.
  if (rateLimitMap.size > MAX_TRACKED_USERS) {
    for (const [k, v] of rateLimitMap) {
      const fresh = v.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (fresh.length === 0) rateLimitMap.delete(k);
      else rateLimitMap.set(k, fresh);
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// POST /api/health-query
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
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

  // Rate limit check
  if (!checkRateLimit(userId)) {
    return apiError(429, 'rate_limited', 'You have exceeded the maximum of 30 queries per hour. Please try again later.');
  }

  let query: string;
  try {
    const body = await request.json();
    query = body.query;
  } catch {
    return apiError(400, 'invalid_body', 'Invalid JSON request body');
  }

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return apiError(400, 'invalid_query', 'Query text is required');
  }

  query = query.trim();

  try {
    // ------------------------------------------------------------------
    // Gather health context via the repos. The legacy queries filtered on
    // user_id only (no dependent filter) — scope 'all' preserves that.
    // ------------------------------------------------------------------
    const scope = { ownerId: userId, dependentId: 'all' as const };
    // VITALS are the exception: aggregates present per-metric stats as ONE
    // person's trends, so blending a dependent's readings into the owner's
    // averages would be clinically wrong. Owner rows only (dependent IS NULL).
    const ownVitalsScope = { ownerId: userId, dependentId: null };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

    // Recent-training block covers the trailing 14 days (spec §AI #1).
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const fourteenDaysAgoISO = fourteenDaysAgo.toISOString();

    const now = new Date().toISOString();

    const [
      profile,
      medications,
      allLabVisits,
      vitals,
      allConditions,
      allNotes,
      allAppointments,
      activeGoals,
      recentWorkouts,
    ] = await Promise.all([
      getProfile(userId, userId),
      // Active medications, name asc
      listMedications(userId, scope, { active: true, orderBy: 'name' }),
      // Visits are ordered visit_date desc; the last 2 are sliced below
      listLabVisitsWithResults(userId, scope),
      // Recent vitals (last 30 days), recorded_at desc
      listVitals(userId, ownVitalsScope, { startDate: thirtyDaysAgoISO }),
      listConditions(userId, scope),
      listNotes(userId, scope),
      listAppointments(userId, scope),
      // Fitness context is owner-scoped like the vitals aggregates: goals
      // are strictly per-user, and sessions read owner rows only.
      listGoals(userId, userId, { active: true }),
      listWorkouts(userId, ownVitalsScope, { from: fourteenDaysAgoISO }),
    ]);

    // Recent lab visits (last 2) with results, test_name asc within a visit
    const labVisits = allLabVisits.slice(0, 2).map((v) => ({
      ...v,
      labResults: [...v.labResults].sort((a, b) =>
        a.testName.localeCompare(b.testName),
      ),
    }));
    // Each result carries its visit's draw date so lab-derived findings can
    // be date-framed (spec §AI #2).
    const labResultsData = labVisits.flatMap((v) =>
      v.labResults.map((r) => ({ ...r, visitDate: v.visitDate })),
    );

    // Active conditions, name asc (legacy: status in (...), order name)
    const conditions = allConditions
      .filter((c) => ['active', 'managed', 'monitoring'].includes(c.status))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Recent notes (last 30 days), recorded_at desc (repo default order)
    const notes = allNotes.filter((n) => n.recordedAt >= thirtyDaysAgoISO);

    // Upcoming appointments, appointment_date asc
    const appointments = allAppointments
      .filter((a) => a.appointmentDate >= now)
      .sort((a, b) => a.appointmentDate.localeCompare(b.appointmentDate));

    // ------------------------------------------------------------------
    // Format context strings
    // ------------------------------------------------------------------

    // Profile
    const profileStr = profile
      ? [
          profile.displayName ? `Name: ${profile.displayName}` : null,
          profile.dateOfBirth ? `DOB: ${profile.dateOfBirth}` : null,
          profile.biologicalSex ? `Sex: ${profile.biologicalSex}` : null,
          profile.heightInches ? `Height: ${profile.heightInches} inches` : null,
          profile.weightLbs ? `Weight: ${profile.weightLbs} lbs` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : '';

    // Medications
    const medicationsStr = medications
      .map(
        (m) =>
          `- ${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? `, ${m.frequency}` : ''}${m.notes ? ` (${m.notes})` : ''}`
      )
      .join('\n');

    // Lab results grouped by visit
    const labResultsStr = labVisits
      .map((visit) => {
        const lines = visit.labResults.map(
          (r) =>
            `  - ${r.testName}: ${r.value} ${r.unit ?? ''}${r.referenceRangeText ? ` (ref: ${r.referenceRangeText})` : ''}${r.flag && r.flag !== 'normal' ? ` [${r.flag.toUpperCase()}]` : ''}`
        );
        return `Visit ${visit.visitDate}:\n${lines.join('\n')}`;
      })
      .join('\n\n');

    // Vitals: per-metric 30-day aggregates grouped by category, plus the last
    // few raw readings for intraday metrics (glucose/BP) whose spikes the
    // aggregates would hide.
    const vitalsStr = [
      formatAggregatesForPrompt(aggregateVitals(vitals)),
      formatIntradayReadings(vitals),
    ]
      .filter(Boolean)
      .join('\n\n');

    // Flagged values: out-of-range labs + any abnormal vitals
    const flaggedLabs = labResultsData.filter((r) => r.flag && r.flag !== 'normal');
    const flaggedLabsStr = flaggedLabs
      .map(
        (r) =>
          `- LAB: ${r.testName}: ${r.value} ${r.unit ?? ''} [${(r.flag ?? '').toUpperCase()}]${r.referenceRangeText ? ` (ref: ${r.referenceRangeText})` : ''} — drawn ${r.visitDate}`
      )
      .join('\n');
    const flaggedStr = flaggedLabsStr || '';

    // Conditions
    const conditionsStr = conditions
      .map(
        (c) =>
          `- ${c.name} (${c.status})${c.diagnosedDate ? ` diagnosed ${c.diagnosedDate}` : ''}${c.notes ? ` - ${c.notes}` : ''}`
      )
      .join('\n');

    // Notes
    const notesStr = notes
      .map(
        (n) =>
          `- [${n.noteType}] ${n.recordedAt.slice(0, 10)}: ${n.content}${n.severity ? ` (severity: ${n.severity}/10)` : ''}`
      )
      .join('\n');

    // Appointments
    const appointmentsStr = appointments
      .map(
        (a) =>
          `- ${a.appointmentDate.slice(0, 10)}${a.reason ? `: ${a.reason}` : ''}${a.notes ? ` (${a.notes})` : ''}`
      )
      .join('\n');

    // Fitness: active goals + compact recent-training block. Both formatters
    // return '' when empty, so the prompt falls back to its placeholder.
    const fitnessStr = [
      formatGoalsForPrompt(activeGoals),
      formatRecentTrainingForPrompt(recentWorkouts, activeGoals),
    ]
      .filter(Boolean)
      .join('\n\n');

    const healthContext: HealthContext = {
      profile_data: profileStr,
      medications_data: medicationsStr,
      lab_results_data: labResultsStr,
      vitals_data: vitalsStr,
      flagged_data: flaggedStr,
      conditions_data: conditionsStr,
      recent_notes: notesStr,
      appointments_data: appointmentsStr,
      fitness_data: fitnessStr,
    };

    // ------------------------------------------------------------------
    // Call Claude
    // ------------------------------------------------------------------
    let responseText: string;
    try {
      responseText = await queryHealthData(query, healthContext);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('timeout') || err.message.includes('ETIMEDOUT') || err.message.includes('AbortError'))
      ) {
        return apiError(
          504,
          'ai_timeout',
          'The AI query timed out. Please try again with a simpler question.'
        );
      }
      throw err;
    }

    // Append disclaimer
    const disclaimer = '\n\n⚠️ ' + AI_DISCLAIMER;
    responseText = responseText + disclaimer;

    // ------------------------------------------------------------------
    // Save to query_history
    // ------------------------------------------------------------------
    try {
      const saved = await createQueryHistoryEntry(userId, {
        queryText: query,
        responseText,
      });
      const entry: QueryHistoryEntry = {
        id: saved.id,
        user_id: saved.userId,
        query_text: saved.queryText,
        response_text: saved.responseText,
        created_at: saved.createdAt,
      };
      return NextResponse.json(entry);
    } catch (saveError) {
      // If save fails, still return the response but log the error
      safeError('Failed to save query history', saveError);
      const fallback: QueryHistoryEntry = {
        id: '',
        user_id: userId,
        query_text: query,
        response_text: responseText,
        created_at: new Date().toISOString(),
      };
      return NextResponse.json(fallback);
    }
  } catch (err) {
    safeError('Health query error', err);
    return apiError(500, 'internal_error', 'Failed to process health query. Please try again.');
  }
}
