'use client';

import React, { useState } from 'react';
import { useWeekRollup } from '@/hooks/useWeekRollup';
import { priorWeekStart, weekStartOf } from '@/lib/fitness/weeks';
import { shiftDayKey, formatUtcDay, formatUtcDayYear } from '@/lib/dates';
import { formatMetricValue } from '@/lib/metrics/format';
import {
  SESSION_TYPE_OPTIONS,
  type WeekRollupWire,
} from '@/lib/fitness/api-types';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import CheckinForm from './CheckinForm';

// ---------------------------------------------------------------------------
// Weekly tab — Monday-week navigator over the computed rollup
// (GET /api/weeks/{weekStart}, shared src/lib/fitness/rollup.ts): sessions by
// type, body/recovery averages with prior-week deltas, frequency-goal
// progress bars, and the check-in form (PUT = full replacement, prefilled
// from the rollup's embedded row).
// ---------------------------------------------------------------------------

interface StatRowSpec {
  label: string;
  value: number | null;
  delta: number | null;
  unit?: string;
  decimals?: number;
}

function formatValue(value: number | null, decimals: number, unit?: string): string {
  if (value === null) return '—';
  return `${formatMetricValue(value, decimals)}${unit ? ` ${unit}` : ''}`;
}

function formatDelta(delta: number | null, decimals: number): string | null {
  if (delta === null) return null;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${formatMetricValue(delta, decimals)} vs prior week`;
}

function StatRows({ rows }: { rows: StatRowSpec[] }) {
  return (
    <dl className="space-y-2">
      {rows.map((row) => {
        const decimals = row.decimals ?? 1;
        const delta = formatDelta(row.delta, decimals);
        return (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {row.label}
            </dt>
            <dd className="text-right">
              <span
                className="text-sm font-mono font-semibold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {formatValue(row.value, decimals, row.unit)}
              </span>
              {delta && (
                <span className="block text-[11px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                  {delta}
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function GoalProgressBar({
  sessionType,
  completed,
  perWeek,
  met,
}: {
  sessionType: string;
  completed: number;
  perWeek: number;
  met: boolean;
}) {
  const pct = Math.min(100, (completed / perWeek) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: 'var(--color-text-primary)' }}>
          {sessionType} — {completed}/{perWeek} this week
        </span>
        {met && (
          <span className="font-medium" style={{ color: 'var(--color-sage)' }}>
            Met ✓
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={perWeek}
        aria-label={`${sessionType} sessions: ${completed} of ${perWeek}`}
        className="h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--border-card)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: 'var(--color-sage)' }}
        />
      </div>
    </div>
  );
}

const cardClass = 'rounded-xl border p-5';
const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  borderColor: 'var(--border-card)',
};

export interface WeekSummaryProps {
  rollup: WeekRollupWire;
}

/** Presentational rollup display (exported for tests). */
export function WeekSummary({ rollup }: WeekSummaryProps) {
  const { sessions, body, recovery, frequency_goals: goals, prior_week_deltas: deltas } = rollup;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Sessions */}
      <section className={cardClass} style={cardStyle} aria-label="Sessions">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
          Sessions
          <span className="ml-2 font-mono" style={{ color: 'var(--color-sage)' }}>
            {sessions.total}
          </span>
          {deltas.sessions_total !== null && deltas.sessions_total !== 0 && (
            <span className="ml-2 text-[11px] font-mono font-normal" style={{ color: 'var(--color-text-muted)' }}>
              {deltas.sessions_total > 0 ? '+' : ''}
              {deltas.sessions_total} vs prior week
            </span>
          )}
        </h3>
        {sessions.total === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            No sessions logged this week.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {SESSION_TYPE_OPTIONS.filter((t) => sessions.by_type[t]?.count > 0).map((t) => {
              const bucket = sessions.by_type[t];
              return (
                <li key={t} className="text-sm flex items-baseline gap-2">
                  <span className="font-mono font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {bucket.count}×
                  </span>
                  <span style={{ color: 'var(--color-text-primary)' }}>{t}</span>
                  {bucket.labels.length > 0 && (
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {bucket.labels.join(', ')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Frequency-goal progress */}
        {goals.length > 0 && (
          <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: 'var(--border-card)' }}>
            {goals.map((g) => (
              <GoalProgressBar
                key={g.goal_id}
                sessionType={g.session_type}
                completed={g.completed}
                perWeek={g.per_week}
                met={g.met}
              />
            ))}
          </div>
        )}
      </section>

      {/* Body */}
      <section className={cardClass} style={cardStyle} aria-label="Body">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
          Body
        </h3>
        <StatRows
          rows={[
            { label: 'Avg weight', value: body.weight_avg, delta: deltas.weight_avg, unit: 'lb' },
            { label: 'Min weight', value: body.weight_min, delta: deltas.weight_min, unit: 'lb' },
            {
              label: 'Days weighed',
              value: body.days_weighed,
              delta: deltas.days_weighed,
              decimals: 0,
            },
            {
              label: 'Avg body fat',
              value: body.body_fat_pct_avg,
              delta: deltas.body_fat_pct_avg,
              unit: '%',
            },
            {
              label: 'Avg fat-free mass',
              value: body.fat_free_mass_avg,
              delta: deltas.fat_free_mass_avg,
              unit: 'lb',
            },
          ]}
        />
        {(body.neck_latest || body.waist_latest) && (
          <p className="mt-3 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {body.neck_latest &&
              `Neck ${body.neck_latest.value} in (as of ${formatUtcDay(body.neck_latest.recorded_at)})`}
            {body.neck_latest && body.waist_latest && ' · '}
            {body.waist_latest &&
              `Waist ${body.waist_latest.value} in (as of ${formatUtcDay(body.waist_latest.recorded_at)})`}
          </p>
        )}
      </section>

      {/* Recovery */}
      <section className={cardClass} style={cardStyle} aria-label="Recovery">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
          Recovery
        </h3>
        <StatRows
          rows={[
            {
              label: 'Avg HRV (rMSSD)',
              value: recovery.hrv_rmssd_avg,
              delta: deltas.hrv_rmssd_avg,
              unit: 'ms',
              decimals: 0,
            },
            {
              label: 'Avg readiness',
              value: recovery.readiness_score_avg,
              delta: deltas.readiness_score_avg,
              decimals: 0,
            },
            {
              label: 'Avg sleep score',
              value: recovery.sleep_score_avg,
              delta: deltas.sleep_score_avg,
              decimals: 0,
            },
            {
              label: 'Avg sleep',
              value: recovery.sleep_duration_avg,
              delta: deltas.sleep_duration_avg,
              unit: 'hrs',
            },
          ]}
        />
      </section>
    </div>
  );
}

/** Data-fetching Weekly tab with the Monday navigator. */
export default function WeeklyView() {
  const [currentWeek] = useState(() =>
    weekStartOf(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
  const [weekStart, setWeekStart] = useState(currentWeek);
  const { rollup, loading, error, saveCheckin } = useWeekRollup(weekStart);

  const isCurrent = weekStart === currentWeek;
  const weekEnd = shiftDayKey(weekStart, 6);

  return (
    <div className="space-y-4">
      {/* Week navigator */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setWeekStart(priorWeekStart(weekStart))}
          aria-label="Previous week"
          className="px-3 py-1.5 rounded-lg text-sm cursor-pointer"
          style={{ border: '1px solid var(--border-card)', color: 'var(--color-text-primary)' }}
        >
          ← Prev
        </button>
        <span className="text-sm font-medium px-1" style={{ color: 'var(--color-text-primary)' }}>
          {formatUtcDay(weekStart)} – {formatUtcDayYear(weekEnd)}
          {isCurrent && (
            <span className="ml-2 text-[11px]" style={{ color: 'var(--color-sage)' }}>
              this week
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setWeekStart(shiftDayKey(weekStart, 7))}
          disabled={isCurrent}
          aria-label="Next week"
          className="px-3 py-1.5 rounded-lg text-sm cursor-pointer disabled:opacity-30"
          style={{ border: '1px solid var(--border-card)', color: 'var(--color-text-primary)' }}
        >
          Next →
        </button>
        {!isCurrent && (
          <button
            type="button"
            onClick={() => setWeekStart(currentWeek)}
            className="px-3 py-1.5 rounded-lg text-sm cursor-pointer"
            style={{ border: '1px solid var(--border-card)', color: 'var(--color-sage)' }}
          >
            This week
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(224, 122, 95, 0.12)',
            borderColor: 'var(--color-terracotta)',
            color: 'var(--color-terracotta)',
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : rollup ? (
        <>
          <WeekSummary rollup={rollup} />
          <div className={cardClass} style={cardStyle}>
            <CheckinForm
              weekStart={weekStart}
              initial={rollup.checkin}
              neckLatest={rollup.body.neck_latest}
              waistLatest={rollup.body.waist_latest}
              onSave={async (body) => {
                await saveCheckin(body);
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
