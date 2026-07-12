'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HealthSummary, HealthSummaryHighlight } from '@/lib/claude/health-summary';
import { useCapabilities } from '@/hooks/useCapabilities';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

/** Server adds cache metadata alongside the HealthSummary payload. */
type SummaryResponse = HealthSummary & {
  cached?: boolean;
  stale?: boolean;
  generated_at?: string | null;
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** `2026-05-26` → `May 26, 2026` — split manually to avoid TZ day-shift. */
function formatDrawDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return isoDate;
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

// Collapse choice is persisted for the current local day only: the stored value
// IS the day it applies to, so a stale key from a previous day is simply
// ignored (and never needs cleanup — it's overwritten or falls out of use).
const COLLAPSE_KEY = 'ht:health-overview-collapsed';

function localDayKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** First clause of the summary — the teaser shown while collapsed. */
function firstClause(summary: string): string {
  const trimmed = summary.trim();
  const match = trimmed.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : trimmed).trim();
}

const HIGHLIGHT_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  positive: {
    bg: 'rgba(129, 178, 154, 0.08)',
    border: 'var(--color-sage)',
    icon: '✓',
  },
  attention: {
    bg: 'rgba(224, 122, 95, 0.08)',
    border: 'var(--color-terracotta)',
    icon: '⚠',
  },
  action: {
    bg: 'rgba(167, 139, 250, 0.08)',
    border: 'var(--accent-purple)',
    icon: '→',
  },
};

export default function HealthSummaryCard() {
  const { capabilities } = useCapabilities();
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const [dismissingIndex, setDismissingIndex] = useState<number | null>(null);

  // Restore today's collapse choice (ignore a key stored on a previous day).
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === localDayKey()) {
        setCollapsed(true);
      }
    } catch {
      // localStorage unavailable (SSR / privacy mode) — default to expanded.
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(COLLAPSE_KEY, localDayKey());
        else localStorage.removeItem(COLLAPSE_KEY);
      } catch {
        // Non-fatal — the toggle still works for this session.
      }
      return next;
    });
  }, []);

  // Dismiss-until-new-labs: persist the dismissal (keyed server-side to the
  // latest lab visit date) and drop the card locally. Failures are soft —
  // the card simply stays, matching the card's overall soft-fail posture.
  const dismissHighlight = useCallback(
    async (index: number, highlight: HealthSummaryHighlight) => {
      if (!highlight.labTests || highlight.labTests.length === 0) return;
      setDismissingIndex(index);
      try {
        const res = await fetch('/api/lab-warning-dismissals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tests: highlight.labTests }),
        });
        if (!res.ok) throw new Error('Failed to dismiss');
        setData((prev) =>
          prev
            ? { ...prev, highlights: prev.highlights.filter((_, i) => i !== index) }
            : prev,
        );
      } catch {
        // Leave the card in place; the user can retry.
      } finally {
        setDismissingIndex(null);
      }
    },
    [],
  );

  const fetchSummary = useCallback(async (isRefresh: boolean) => {
    setError(null);
    // Only the very first load shows the full-card spinner; a manual refresh
    // keeps the existing summary visible and shows a subtle "updating…".
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(isRefresh ? '/api/health-summary?refresh=1' : '/api/health-summary');
      if (!res.ok) throw new Error('Failed to load summary');
      const json = (await res.json()) as SummaryResponse;
      setData(json);
      setHasLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Fetch once per page visit — but only after capabilities confirm the
  // instance has AI configured (avoids a guaranteed 501).
  useEffect(() => {
    if (capabilities?.ai && !hasLoaded) {
      fetchSummary(false);
    }
  }, [capabilities?.ai, hasLoaded, fetchSummary]);

  // AI not configured on this instance — the card has nothing to offer.
  if (!capabilities?.ai) return null;

  // "updating…" affordance: a background regeneration is in flight (server
  // served a stale row) or the user just triggered a manual refresh.
  const updating = refreshing || Boolean(data?.stale);
  const showInitialSpinner = loading && !data;

  return (
    <section
      className="rounded-xl border p-5"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="health-overview-body"
            className="flex items-center gap-2 cursor-pointer"
            title={collapsed ? 'Expand health overview' : 'Collapse health overview'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 transition-transform"
              style={{
                color: 'var(--color-text-muted)',
                transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Health Overview
            </h2>
          </button>
          {updating && data && (
            <span
              className="text-xs font-medium"
              style={{ color: 'var(--color-text-muted)' }}
              aria-live="polite"
            >
              updating…
            </span>
          )}
        </div>

        {hasLoaded && !showInitialSpinner && (
          <button
            type="button"
            onClick={() => fetchSummary(true)}
            disabled={refreshing}
            className="text-xs font-medium cursor-pointer flex items-center gap-1 disabled:opacity-50"
            style={{ color: 'var(--color-sage)' }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        )}
      </div>

      {showInitialSpinner && (
        <div className="flex items-center gap-3 py-4">
          <LoadingSpinner size="sm" />
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Generating your health overview...
          </span>
        </div>
      )}

      {error && !loading && !data && (
        // AI is configured (we only fetch when capabilities.ai) but the call
        // failed at runtime. Keep it calm and non-alarming — this is an
        // optional enhancement, not a broken page.
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          AI summary is temporarily unavailable.
        </p>
      )}

      {data && !showInitialSpinner && collapsed && (
        // Collapsed for the day: keep a one-line teaser so it's not fully
        // hidden; the header chevron re-expands it.
        <p
          id="health-overview-body"
          className="text-sm leading-relaxed truncate"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {firstClause(data.summary)}
        </p>
      )}

      {data && !showInitialSpinner && !collapsed && (
        <div id="health-overview-body" className="space-y-4">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {data.summary}
          </p>

          {data.highlights.length > 0 && (
            <div className="space-y-2">
              {data.highlights.map((h, i) => {
                const style = HIGHLIGHT_STYLES[h.type] ?? HIGHLIGHT_STYLES.action;
                const isLabDerived = Boolean(h.labTests && h.labTests.length > 0);
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm"
                    style={{
                      backgroundColor: style.bg,
                      borderLeft: `3px solid ${style.border}`,
                    }}
                  >
                    <span className="shrink-0 text-xs mt-0.5">{style.icon}</span>
                    <span className="flex-1" style={{ color: 'var(--color-text-primary)' }}>
                      {h.text}
                      {h.labAsOf && (
                        <span
                          className="block text-xs mt-0.5"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          As of your {formatDrawDate(h.labAsOf)} lab draw
                        </span>
                      )}
                    </span>
                    {isLabDerived && (
                      <button
                        type="button"
                        onClick={() => dismissHighlight(i, h)}
                        disabled={dismissingIndex === i}
                        aria-label="Dismiss until new lab results"
                        title="Dismiss until new lab results"
                        className="shrink-0 text-xs mt-0.5 cursor-pointer leading-none disabled:opacity-50"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p
            className="text-xs italic pt-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            AI-generated overview — not medical advice. Always consult your healthcare provider.
          </p>
        </div>
      )}
    </section>
  );
}
