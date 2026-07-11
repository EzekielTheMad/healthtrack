'use client';

import React, { useMemo, useState } from 'react';
import { useVitals } from '@/hooks/useVitals';
import {
  buildDailySections,
  type DailySection,
  type DailyEntry,
} from '@/lib/metrics/vitals-view';
import { CATEGORY_LABELS } from '@/lib/metrics/registry';
import type { ActiveMetricGoal } from '@/lib/fitness/goal-direction';
import { displayUnit } from '@/lib/metrics/format';
import { dayKeyToUtcIso, formatLocalTime, localDayKey, shiftDayKey } from '@/lib/dates';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

// ---------------------------------------------------------------------------
// Daily view — "how was <day>?": a compact per-day table grouped by registry
// category, with a delta vs the trailing 7-day average per metric. Fetches
// its own padded window (selected day + prior 7 days, ±1 day of slack for
// intraday local-day boundaries) via the existing GET /api/vitals.
// ---------------------------------------------------------------------------

interface DailyVitalsViewProps {
  /** Initial day (YYYY-MM-DD) — the most recent day with data, or today. */
  initialDay: string;
  /** Active metric goals — override registry directions in delta tones. */
  metricGoals?: readonly ActiveMetricGoal[];
}

/** `2026-07-08` → `Wednesday, Jul 8, 2026` (parsed as local midnight — safe). */
function formatDayHeading(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function DeltaCell({ entry }: { entry: DailyEntry }) {
  const { delta } = entry;
  if (!delta) {
    return (
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        —
      </span>
    );
  }

  const arrow = delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '—';
  // Judged by the effective goal direction (active metric goal over the
  // registry default) — a falling resting HR is good, a falling step count is
  // not, drifting off a maintain goal warns, directionless metrics stay muted.
  const color =
    delta.tone === 'good'
      ? 'var(--color-sage)'
      : delta.tone === 'warn'
        ? 'var(--color-warning)'
        : delta.tone === 'bad'
          ? 'var(--color-terracotta)'
          : 'var(--color-text-muted)';
  const baselineLabel = entry.aggregate === 'sum' ? 'vs 7d daily avg' : 'vs 7d avg';

  return (
    <span
      className="text-xs font-mono inline-flex items-baseline gap-1"
      style={{ color, opacity: 0.85 }}
      title={
        entry.aggregate === 'sum'
          ? 'Compared to the trailing 7-day daily average (total / 7)'
          : 'Compared to the trailing 7-day average'
      }
    >
      <span aria-hidden="true">{arrow}</span>
      {delta.direction === 'flat' ? (
        <span>no change {baselineLabel}</span>
      ) : (
        <span>
          {delta.display}
          {entry.unit ? ` ${displayUnit(entry.unit)}` : ''} {baselineLabel}
        </span>
      )}
    </span>
  );
}

/** Presentational per-day table (exported for tests). */
export function DailyTable({ sections }: { sections: DailySection[] }) {
  if (sections.length === 0) {
    return (
      <div
        className="rounded-xl border p-8 text-center text-sm"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border-card)',
          color: 'var(--color-text-muted)',
        }}
      >
        No vitals recorded on this day.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.category}>
          <h2
            className="text-sm font-semibold mb-2 uppercase tracking-wide"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {CATEGORY_LABELS[section.category]}
          </h2>
          <div
            className="rounded-xl border divide-y"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-card)',
            }}
          >
            {section.entries.map((entry) => (
              <div
                key={entry.key}
                className="flex items-start justify-between gap-4 px-4 py-2.5"
                style={{ borderColor: 'var(--border-card)' }}
              >
                <span
                  className="text-sm shrink-0 pt-0.5"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {entry.label}
                </span>
                <div className="flex flex-col items-end gap-0.5 text-right">
                  {entry.readings.map((reading, i) => (
                    <span
                      key={`${reading.recordedAt}-${i}`}
                      className="text-sm font-mono"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {reading.display}
                      {entry.unit && !entry.duration && (
                        <span
                          className="text-xs ml-1"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {displayUnit(entry.unit)}
                        </span>
                      )}
                      {entry.intraday && (
                        <span
                          className="text-xs ml-2"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {formatLocalTime(reading.recordedAt)}
                        </span>
                      )}
                    </span>
                  ))}
                  <DeltaCell entry={entry} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function DailyVitalsView({ initialDay, metricGoals = [] }: DailyVitalsViewProps) {
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const today = localDayKey();

  // Padded fetch window: prior 7 days for the delta baseline, plus a day of
  // slack on each side so intraday readings keyed by LOCAL day are covered
  // in any timezone.
  const startDate = dayKeyToUtcIso(shiftDayKey(selectedDay, -8));
  const endDate = dayKeyToUtcIso(shiftDayKey(selectedDay, 2));
  const { vitals, loading, error } = useVitals({ startDate, endDate });

  const sections = useMemo(
    () => buildDailySections(vitals, selectedDay, metricGoals),
    [vitals, selectedDay, metricGoals],
  );

  const navButtonStyle: React.CSSProperties = {
    border: '1px solid var(--border-card)',
    color: 'var(--color-text-primary)',
    backgroundColor: 'var(--bg-card)',
  };

  return (
    <div className="space-y-4">
      {/* Day navigation */}
      <div
        className="rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <button
          type="button"
          onClick={() => setSelectedDay((d) => shiftDayKey(d, -1))}
          aria-label="Previous day"
          className="px-2.5 py-1.5 rounded-lg text-sm cursor-pointer"
          style={navButtonStyle}
        >
          ‹
        </button>
        <input
          type="date"
          value={selectedDay}
          max={today}
          onChange={(e) => {
            if (e.target.value) setSelectedDay(e.target.value);
          }}
          aria-label="Selected day"
          className="px-2 py-1 rounded-lg text-xs font-mono"
          style={{
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--border-card)',
          }}
        />
        <button
          type="button"
          onClick={() => setSelectedDay((d) => shiftDayKey(d, 1))}
          disabled={selectedDay >= today}
          aria-label="Next day"
          className="px-2.5 py-1.5 rounded-lg text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          style={navButtonStyle}
        >
          ›
        </button>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {formatDayHeading(selectedDay)}
        </span>
      </div>

      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(224, 122, 95, 0.12)',
            borderColor: 'var(--color-terracotta)',
            color: 'var(--color-terracotta)',
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <DailyTable sections={sections} />
      )}
    </div>
  );
}
