'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useVitals } from '@/hooks/useVitals';
import {
  buildFocusPanels,
  type ApneaNight,
  type FocusPanel,
  type FocusPanelId,
  type FocusStat,
  type StatTone,
  type VerdictTone,
} from '@/lib/metrics/focus';
import { DAY_MS } from '@/lib/metrics/aggregate';
import { bucketWeekly, shouldBucketWeekly, type ChartPoint } from '@/lib/metrics/vitals-view';
import { formatDuration, formatMetricValue, isDurationMetric } from '@/lib/metrics/format';
import { getMetric } from '@/lib/metrics/registry';
import { getVitalRange } from '@/lib/reference-ranges';
import type { Vital } from '@/lib/types';
import BarChart from './BarChart';
import VitalTrendChart from './VitalTrendChart';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

// ---------------------------------------------------------------------------
// Focus view — the goal-oriented default: up to four data-gated panels
// (sleep apnea therapy, recovery, body composition, activity), each with a
// verdict badge, a small stat grid, an optional evidence strip, and a
// "View charts" affordance that expands the relevant existing chart
// components inline (one panel at a time). Fetches its own fixed 90-day
// window via GET /api/vitals, independent of the page's range chips.
// ---------------------------------------------------------------------------

/** Fixed fetch window for the focus math (90 days back from mount). */
const FOCUS_WINDOW_DAYS = 90;

// Verdict badges reuse the app's muted tint convention (color + rgba tint of
// the same palette value — see NoteFeed/ConditionCard badge maps).
const VERDICT_STYLES: Record<VerdictTone, { color: string; bg: string }> = {
  success: { color: 'var(--color-sage)', bg: 'rgba(129, 178, 154, 0.12)' },
  warning: { color: 'var(--color-warning)', bg: 'rgba(233, 196, 106, 0.15)' },
  danger: { color: 'var(--color-terracotta)', bg: 'rgba(224, 122, 95, 0.12)' },
  neutral: { color: 'var(--color-text-muted)', bg: 'rgba(155, 155, 155, 0.12)' },
};

const STAT_TONE_COLORS: Record<StatTone, string> = {
  good: 'var(--color-sage)',
  warn: 'var(--color-warning)',
  bad: 'var(--color-terracotta)',
  neutral: 'var(--color-text-muted)',
};

const PANEL_ICONS: Record<FocusPanelId, string> = {
  apnea: '🌙',
  recovery: '🔋',
  body: '⚖️',
  activity: '👟',
};

function VerdictBadge({ label, tone }: { label: string; tone: VerdictTone }) {
  const style = VERDICT_STYLES[tone];
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
      style={{ color: style.color, backgroundColor: style.bg }}
    >
      {label}
    </span>
  );
}

function StatCell({ stat }: { stat: FocusStat }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
        {stat.label}
      </span>
      <span className="flex items-baseline gap-1">
        <span
          className="text-xl font-mono font-semibold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {stat.value}
        </span>
        {stat.unit && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {stat.unit}
          </span>
        )}
      </span>
      {stat.sub && (
        <span
          className="text-[11px] font-mono"
          style={{ color: STAT_TONE_COLORS[stat.tone], opacity: 0.9 }}
        >
          {stat.sub}
        </span>
      )}
    </div>
  );
}

/** 14-night AHI strip: bar height = AHI (scaled to max(5, max)), gray = unused night. */
function ApneaStrip({ nights }: { nights: ApneaNight[] }) {
  const maxH = 40;
  const barW = 10;
  const gap = 6;
  const width = nights.length * (barW + gap) - gap;
  const scale = Math.max(5, ...nights.map((n) => n.ahi ?? 0));

  return (
    <svg
      viewBox={`0 0 ${width} ${maxH}`}
      width="100%"
      height={maxH}
      preserveAspectRatio="xMinYMax meet"
      role="img"
      aria-label="Nightly AHI, last 14 nights"
      style={{ display: 'block', maxWidth: 320 }}
    >
      {nights.map((night, i) => {
        const x = i * (barW + gap);
        const h =
          night.ahi !== null ? Math.max(2, (night.ahi / scale) * maxH) : 3;
        return (
          <rect
            key={night.dayKey}
            x={x}
            y={maxH - h}
            width={barW}
            height={h}
            rx={2}
            fill={night.used ? 'var(--color-sage)' : 'var(--color-text-muted)'}
            opacity={night.used ? 0.85 : 0.45}
          >
            <title>
              {`${night.dayKey}: ${night.ahi !== null ? `AHI ${formatMetricValue(night.ahi, 1)}` : 'no AHI reading'}${night.used ? '' : ' · no CPAP use'}`}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

interface PanelChartsProps {
  panel: FocusPanel;
  byMetric: Map<string, Vital[]>;
  userAge: number;
  userSex: 'male' | 'female' | 'prefer_not_to_say';
  weeklyBars: boolean;
}

/** Expanded inline charts — same rendering rules as the All-metrics view. */
function PanelCharts({ panel, byMetric, userAge, userSex, weeklyBars }: PanelChartsProps) {
  return (
    <div
      className="mt-4 pt-4 space-y-6 border-t"
      style={{ borderColor: 'var(--border-card)' }}
      role="region"
      aria-label={`${panel.title} charts`}
    >
      {panel.chartMetrics.map((key) => {
        const metric = getMetric(key);
        const data = byMetric.get(key) ?? [];
        const label = metric?.label ?? key;
        const range = getVitalRange(key, userAge, userSex);
        const isBar = metric?.chart === 'bar';

        if (isBar) {
          let points: ChartPoint[] = data.map((v) => ({
            value: v.value,
            date: v.recorded_at,
          }));
          if (weeklyBars) {
            points = bucketWeekly(points, metric!.aggregate, metric!.decimals ?? 0);
          }
          return (
            <div key={key}>
              <p
                className="text-[11px] uppercase tracking-wider mb-1"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {label}
                {weeklyBars && (
                  <span className="ml-2 normal-case tracking-normal">
                    (weekly {metric!.aggregate === 'sum' ? 'totals' : 'averages'})
                  </span>
                )}
              </p>
              <BarChart
                data={points.map((p) => ({ ...p, label }))}
                height={200}
                refLow={
                  weeklyBars && metric!.aggregate === 'sum'
                    ? undefined
                    : (range?.low ?? undefined)
                }
                refHigh={weeklyBars && metric!.aggregate === 'sum' ? undefined : range?.high}
                decimals={metric!.decimals ?? 0}
                formatValue={isDurationMetric(metric) ? formatDuration : undefined}
              />
            </div>
          );
        }

        return (
          <VitalTrendChart
            key={key}
            data={data.map((v) => ({ value: v.value, recorded_at: v.recorded_at }))}
            metricKey={key}
            label={label}
            refLow={range?.low ?? undefined}
            refHigh={range?.high}
            unit={data[0]?.unit ?? metric?.unit ?? ''}
          />
        );
      })}
    </div>
  );
}

/** Empty state — no panel-eligible device data in the window. */
function FocusEmptyState({ onAddManual }: { onAddManual?: () => void }) {
  return (
    <div
      className="rounded-xl border p-8 flex flex-col items-center text-center"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <h3
        className="text-lg font-semibold mb-2"
        style={{ color: 'var(--color-text-primary)' }}
      >
        No device data yet
      </h3>
      <p className="text-sm max-w-md mb-6" style={{ color: 'var(--color-text-muted)' }}>
        Focus panels appear automatically as your devices start reporting — CPAP,
        sleep tracker, scale, or step counter. Push readings through the{' '}
        <Link
          href="/docs/api"
          className="underline"
          style={{ color: 'var(--color-sage)' }}
        >
          HealthTrack API
        </Link>{' '}
        or enter them manually.
      </p>
      {onAddManual && (
        <button
          type="button"
          onClick={onAddManual}
          className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
          style={{ backgroundColor: 'var(--color-sage)', color: 'var(--bg-primary)' }}
        >
          Add Vital
        </button>
      )}
    </div>
  );
}

export interface FocusPanelListProps {
  panels: FocusPanel[];
  /** 90-day vitals rows backing the expanded charts. */
  vitals: Vital[];
  userAge: number;
  userSex: 'male' | 'female' | 'prefer_not_to_say';
  /** True when the chart window is long enough for weekly bar buckets. */
  weeklyBars?: boolean;
  onAddManual?: () => void;
}

/** Presentational panel list (exported for tests). */
export function FocusPanelList({
  panels,
  vitals,
  userAge,
  userSex,
  weeklyBars = true,
  onAddManual,
}: FocusPanelListProps) {
  /** Id of the single panel with its charts expanded, or null. */
  const [expandedId, setExpandedId] = useState<FocusPanelId | null>(null);

  const byMetric = useMemo(() => {
    const map = new Map<string, Vital[]>();
    for (const v of vitals) {
      const list = map.get(v.metric_key);
      if (list) list.push(v);
      else map.set(v.metric_key, [v]);
    }
    return map;
  }, [vitals]);

  if (panels.length === 0) {
    return <FocusEmptyState onAddManual={onAddManual} />;
  }

  return (
    <div className="space-y-4">
      {panels.map((panel) => {
        const expanded = panel.id === expandedId;
        return (
          <section
            key={panel.id}
            className="rounded-xl border p-5"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
          >
            {/* Header: icon + title + verdict badge */}
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2
                className="text-base font-semibold flex items-center gap-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <span aria-hidden="true">{PANEL_ICONS[panel.id]}</span>
                {panel.title}
              </h2>
              <VerdictBadge label={panel.verdict.label} tone={panel.verdict.tone} />
            </div>

            {/* Stat grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {panel.stats.map((stat) => (
                <StatCell key={stat.key} stat={stat} />
              ))}
            </div>

            {/* Evidence strip (apnea) */}
            {panel.nights && (
              <div className="mt-4">
                <ApneaStrip nights={panel.nights} />
              </div>
            )}

            {/* Footnote caption */}
            {panel.caption && (
              <p className="mt-3 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {panel.caption}
              </p>
            )}

            {/* Inline chart expansion — one panel at a time */}
            {panel.chartMetrics.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId((prev) => (prev === panel.id ? null : panel.id))
                  }
                  aria-expanded={expanded}
                  className="mt-4 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                  style={{
                    border: '1px solid var(--border-card)',
                    color: expanded ? 'var(--color-sage)' : 'var(--color-text-muted)',
                  }}
                >
                  {expanded ? 'Hide charts' : 'View charts'}
                </button>
                {expanded && (
                  <PanelCharts
                    panel={panel}
                    byMetric={byMetric}
                    userAge={userAge}
                    userSex={userSex}
                    weeklyBars={weeklyBars}
                  />
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

interface FocusViewProps {
  userAge: number;
  userSex: 'male' | 'female' | 'prefer_not_to_say';
  /** Opens the manual-entry form (empty-state affordance). */
  onAddManual?: () => void;
}

/**
 * Data-fetching wrapper: pulls a fixed 90-day window (independent of the
 * page's DateRangeContext) and builds the goal panels from it.
 */
export default function FocusView({ userAge, userSex, onAddManual }: FocusViewProps) {
  // Captured once per mount so the fetch effect doesn't re-run every render.
  const [startDate] = useState(() =>
    new Date(Date.now() - FOCUS_WINDOW_DAYS * DAY_MS).toISOString(),
  );
  const { vitals, loading, error } = useVitals({ startDate });

  const panels = useMemo(() => buildFocusPanels(vitals), [vitals]);
  const weeklyBars = shouldBucketWeekly(new Date(startDate), new Date());

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // A failed fetch is not "no device data yet" — show only the error, not
  // the empty state the panel list would render under it.
  if (error) {
    return (
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
    );
  }

  return (
    <FocusPanelList
      panels={panels}
      vitals={vitals}
      userAge={userAge}
      userSex={userSex}
      weeklyBars={weeklyBars}
      onAddManual={onAddManual}
    />
  );
}
