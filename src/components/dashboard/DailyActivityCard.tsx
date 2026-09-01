'use client';

import React, { useMemo } from 'react';
import TrendLine from '@/components/labs/TrendLine';
import { formatUtcDay } from '@/lib/dates';
import type { Vital } from '@/lib/types';

// ---------------------------------------------------------------------------
// Daily activity — Health Connect's aggregate day totals (PRD §6.6).
//
// Source discipline is the whole point of this card. It reads ONLY vitals
// written with source `health_connect_daily`, which come from Health Connect's
// aggregate API — that API has already deduplicated the phone, the watch and
// every app feeding it. Summing raw Fitbit, Samsung, phone or Oura step
// records alongside these would build a second, competing total out of the
// same walk.
//
// Each incoming date REPLACES the stored day (upsertOwnVital is idempotent on
// metric + recorded_at + source), so a re-sync corrects a day rather than
// adding to it.
//
// A metric the snapshot omitted is UNKNOWN, not zero: it produces no vitals
// row at all, and renders here as "—".
// ---------------------------------------------------------------------------

/** Vitals source written by the Health Connect daily-totals normalizer. */
export const DAILY_TOTALS_SOURCE = 'health_connect_daily';

/** Days of history the sparkline covers. */
const TREND_DAYS = 14;

const METRICS = [
  { key: 'steps', label: 'Steps', unit: 'steps', decimals: 0 },
  { key: 'distance', label: 'Distance', unit: 'mi', decimals: 2 },
  { key: 'active_calories', label: 'Active calories', unit: 'kcal', decimals: 0 },
  { key: 'total_calories', label: 'Total calories', unit: 'kcal', decimals: 0 },
] as const;

export interface DailyActivityMetric {
  key: string;
  label: string;
  unit: string;
  /** null when the source never reported this metric — unknown, not zero. */
  latest: number | null;
  latestDate: string | null;
  trend: Array<{ value: number; date: string }>;
}

/**
 * Latest value and recent trend per metric, from canonical daily rows only.
 *
 * Exported for tests: the source filter and the unknown-vs-zero rule are the
 * behaviours worth pinning, and they are pure given a vitals list.
 */
export function buildDailyActivity(vitals: Vital[]): DailyActivityMetric[] {
  const canonical = vitals.filter((v) => v.source === DAILY_TOTALS_SOURCE);

  return METRICS.map((m) => {
    const rows = canonical
      .filter((v) => v.metric_key === m.key && Number.isFinite(v.value))
      .sort(
        (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
      );
    const latest = rows[0] ?? null;
    return {
      key: m.key,
      label: m.label,
      unit: m.unit,
      // No row means the snapshot never carried this metric. Absent, not 0.
      latest: latest ? latest.value : null,
      latestDate: latest ? latest.recorded_at : null,
      trend: rows
        .slice(0, TREND_DAYS)
        .reverse()
        .map((v) => ({ value: v.value, date: v.recorded_at })),
    };
  });
}

function format(value: number | null, decimals: number): string {
  if (value === null) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

interface DailyActivityCardProps {
  vitals: Vital[];
  loading?: boolean;
}

export default function DailyActivityCard({ vitals, loading }: DailyActivityCardProps) {
  const metrics = useMemo(() => buildDailyActivity(vitals), [vitals]);
  const anyData = metrics.some((m) => m.latest !== null);

  // Nothing from the phone yet: stay out of the way rather than showing a
  // grid of dashes on a dashboard that has plenty else to say.
  if (loading || !anyData) return null;

  const latestDay = metrics.find((m) => m.latestDate)?.latestDate ?? null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Daily activity
        </h2>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Health Connect daily totals{latestDay ? ` · ${formatUtcDay(latestDay)}` : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => {
          const def = METRICS.find((d) => d.key === m.key)!;
          const known = m.latest !== null;
          return (
            <div
              key={m.key}
              className="rounded-xl border p-5 flex flex-col gap-3"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
            >
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                {m.label}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-2xl font-bold font-mono"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {format(m.latest, def.decimals)}
                </span>
                {known && (
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {m.unit}
                  </span>
                )}
              </div>
              {m.trend.length > 1 ? (
                <TrendLine data={m.trend} width={160} height={40} />
              ) : (
                <div
                  className="flex items-center justify-center h-10 text-[11px]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {known ? 'Not enough data for trend' : 'Not reported'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
