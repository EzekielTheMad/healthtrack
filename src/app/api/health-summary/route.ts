import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED, getCapabilities } from '@/lib/capabilities';
import { safeError } from '@/lib/safe-log';
import type { HealthSummary } from '@/lib/claude/health-summary';
import { filterDismissedLabHighlights } from '@/lib/claude/lab-warnings';
import {
  generateAndCacheSummary,
  ownerLocalDayKey,
} from '@/lib/claude/summary-cache';
import {
  getCachedSummary,
  getLatestCachedSummary,
  parseCachedSummary,
} from '@/lib/repos/daily-summaries';
import { scheduleAfterResponse } from '@/lib/api/after';
import {
  listLabWarningDismissals,
  latestLabVisitDate,
} from '@/lib/repos/lab-warning-dismissals';

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
): Promise<NextResponse> {
  const [dismissals, latestDraw] = await Promise.all([
    listLabWarningDismissals(userId),
    latestLabVisitDate(userId),
  ]);
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
  if (!getCapabilities().ai) {
    return apiError(501, AI_NOT_CONFIGURED, AI_NOT_CONFIGURED);
  }

  const force = request.nextUrl.searchParams.get('refresh') === '1';

  try {
    // Manual refresh: regenerate now (blocking) and serve the fresh summary.
    if (force) {
      const { summary } = await generateAndCacheSummary(userId);
      return buildResponse(userId, summary, {
        cached: false,
        stale: false,
        generatedAt: new Date().toISOString(),
      });
    }

    const today = ownerLocalDayKey();
    const todayRow = await getCachedSummary(userId, today);
    if (todayRow) {
      return buildResponse(userId, parseCachedSummary(todayRow), {
        cached: true,
        stale: false,
        generatedAt: todayRow.generatedAt,
      });
    }

    // No row for today — serve the last good row (if any) instantly and warm
    // today's cache in the background. Nothing is overwritten if regen fails.
    const latest = await getLatestCachedSummary(userId);
    if (latest) {
      scheduleAfterResponse(() => generateAndCacheSummary(userId));
      return buildResponse(userId, parseCachedSummary(latest), {
        cached: true,
        stale: true,
        generatedAt: latest.generatedAt,
      });
    }

    // First ever — nothing cached at all. Generate synchronously (blocks once).
    const { summary } = await generateAndCacheSummary(userId);
    return buildResponse(userId, summary, {
      cached: false,
      stale: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    safeError('Health summary error', err);
    return apiError(500, 'internal_error', 'Failed to generate health summary');
  }
}
