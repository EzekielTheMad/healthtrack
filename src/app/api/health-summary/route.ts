import { AiError } from '@/lib/ai/errors';
import {
  hasAiConfiguration,
  resolveAiConfiguration,
  assertCurrentAiConfiguration,
} from '@/lib/ai/settings';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED } from '@/lib/capabilities';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';
import { safeError } from '@/lib/safe-log';
import type { HealthSummary } from '@/lib/claude/health-summary';
import { filterDismissedLabHighlights } from '@/lib/claude/lab-warnings';
import { generateAndCacheSummary, ownerLocalDayKey } from '@/lib/claude/summary-cache';
import {
  getCachedSummary,
  getLatestCachedSummary,
  parseCachedSummary,
} from '@/lib/repos/daily-summaries';
import { scheduleAfterResponse } from '@/lib/api/after';
import { buildHealthContext, CONTEXT_VERSION } from '@/lib/health-context';
import { listLabWarningDismissals, latestLabVisitDate } from '@/lib/repos/lab-warning-dismissals';

interface SummaryMeta {
  cached: boolean;
  stale: boolean;
  generatedAt: string | null;
}

/**
 * Serialize a summary for the client: apply dismiss-until-new-labs filtering
 * at read time (cheap DB reads — never a model call) so dismissals stay live
 * against a cached row, and attach the cache metadata (cached/stale/generated).
 */
async function buildResponse(
  userId: string,
  summary: HealthSummary,
  meta: SummaryMeta,
  config: import('@/lib/ai/types').AiConfiguration
): Promise<NextResponse> {
  const [dismissals, latestDraw] = await Promise.all([
    listLabWarningDismissals(userId),
    latestLabVisitDate(userId),
  ]);
  assertCurrentAiConfiguration(config);
  return NextResponse.json({
    ...summary,
    highlights: filterDismissedLabHighlights(summary.highlights, dismissals, latestDraw),
    cached: meta.cached,
    stale: meta.stale,
    generated_at: meta.generatedAt,
  });
}

/**
 * GET /api/health-summary — cache-first read of the dashboard AI Health
 * Overview. Never spins when any cache exists:
 *   1. `?refresh=1` → regenerate synchronously (the card's manual Refresh).
 *   2. Today's owner-local row exists → return it instantly (no model call).
 *   3. Else an older row exists → return it as `stale`, and fire-and-forget a
 *      background regeneration for today (the user sees the last good summary
 *      immediately; a failed regen never overwrites the good row).
 *   4. Else (no cache at all — first ever) → generate synchronously, cache,
 *      and return. This is the only blocking path, and happens once.
 */
export async function GET(request: NextRequest) {
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
  if (!hasAiConfiguration(userId)) {
    return apiError(501, AI_NOT_CONFIGURED, AI_NOT_CONFIGURED);
  }

  const force = request.nextUrl.searchParams.get('refresh') === '1';
  if ([...request.nextUrl.searchParams.keys()].some((key) => key !== 'refresh'))
    return apiError(
      400,
      'unsupported_scope',
      'Dashboard summaries are for the signed-in account owner.'
    );

  // Only the manual-refresh path regenerates via AI; cap it (cached reads are
  // free and unlimited).
  if (force && !checkRateLimit(`summary-refresh:${userId}`, { max: 10, windowMs: HOUR_MS })) {
    return apiError(
      429,
      'rate_limited',
      'Too many summary refreshes this hour. Please try again later.'
    );
  }

  try {
    const config = resolveAiConfiguration(userId);
    // Manual refresh: regenerate now (blocking) and serve the fresh summary.
    if (force) {
      const { summary } = await generateAndCacheSummary(userId);
      return buildResponse(
        userId,
        summary,
        {
          cached: false,
          stale: false,
          generatedAt: new Date().toISOString(),
        },
        config
      );
    }

    const today = ownerLocalDayKey();
    const latest =
      (await getCachedSummary(userId, today)) ?? (await getLatestCachedSummary(userId));
    if (latest) {
      const summary = parseCachedSummary(latest);
      const metadata = summary.contextMetadata;
      // Old generated summaries may contain combined patient data. A matching
      // owner row alone is insufficient proof that its clinical scope is safe.
      if (
        metadata?.context_version === CONTEXT_VERSION &&
        metadata.dependent_id === null &&
        metadata.ai?.configuration_revision === config.revision
      ) {
        const current = await buildHealthContext(userId, null, 365);
        const stale = latest.summaryDate !== today || metadata.fingerprint !== current.fingerprint;
        if (stale) scheduleAfterResponse(() => generateAndCacheSummary(userId));
        return buildResponse(
          userId,
          summary,
          {
            cached: true,
            stale,
            generatedAt: latest.generatedAt,
          },
          config
        );
      }
    }

    // No safe cache (including legacy/mismatched patient scopes): generate the
    // owner-only summary synchronously, never displaying the unsafe old text.
    const { summary } = await generateAndCacheSummary(userId);
    return buildResponse(
      userId,
      summary,
      {
        cached: false,
        stale: false,
        generatedAt: new Date().toISOString(),
      },
      config
    );
  } catch (err) {
    if (err instanceof AiError) return apiError(err.status, `ai_${err.code}`, err.message);
    safeError('Health summary error', err);
    return apiError(500, 'internal_error', 'Failed to generate health summary');
  }
}
