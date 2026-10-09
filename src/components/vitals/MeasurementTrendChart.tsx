'use client';

import React, { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_COLORS, CHART_DEFAULTS } from '@/lib/chart-config';
import { formatUtcDay, formatUtcDayYear, formatUtcMonthYear } from '@/lib/dates';
import { formatMetricValue } from '@/lib/metrics/format';
import type { MeasurementSeries } from '@/lib/metrics/measurements';

interface MeasurementTrendChartProps {
  /** One line per series; left/right stay separate and are never combined. */
  series: MeasurementSeries[];
  height?: number;
}

interface HoverPayload {
  date: string;
  source: string;
  value: number | null;
}

/**
 * Multi-series tooltip: value, unit, date and source for every series with a
 * reading on the hovered date. Built on the same Recharts + chart-config stack
 * as VitalTrendChart; the shared single-series ChartTooltip can't carry
 * per-series colors and units, which is the whole point here.
 */
function MeasurementTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    value?: number | null;
    name?: string;
    color?: string;
    payload?: HoverPayload;
    dataKey?: string | number;
  }>;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const rows = payload.filter((p) => p.value !== null && p.value !== undefined);
  if (rows.length === 0) return null;

  const date = rows[0].payload?.date;

  return (
    <div
      style={{
        backgroundColor: CHART_COLORS.cardBg,
        border: `1px solid ${CHART_COLORS.cardBorder}`,
        borderRadius: '8px',
        padding: '10px 14px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
      }}
    >
      {date && (
        <p style={{ color: CHART_COLORS.muted, fontSize: '11px', margin: '0 0 6px 0' }}>
          {formatUtcDayYear(date)}
        </p>
      )}
      {rows.map((rowPayload) => (
        <p
          key={String(rowPayload.dataKey ?? rowPayload.name)}
          style={{
            color: CHART_COLORS.textPrimary,
            fontSize: '13px',
            margin: '0 0 2px 0',
            display: 'flex',
            alignItems: 'baseline',
            gap: '6px',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: rowPayload.color,
              display: 'inline-block',
            }}
          />
          <span>{rowPayload.name}</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>
            {rowPayload.value}
          </span>
        </p>
      ))}
      {rows[0].payload?.source && (
        <p style={{ color: CHART_COLORS.muted, fontSize: '11px', margin: '6px 0 0 0' }}>
          via {rows[0].payload.source}
        </p>
      )}
    </div>
  );
}

/**
 * Sparse multi-series circumference chart.
 *
 * Every series is plotted against a shared numeric TIME axis, so readings
 * taken on different days line up honestly instead of being forced onto a
 * shared category index. Series carry explicit null breaks across long gaps
 * (see MEASUREMENT_GAP_DAYS) and `connectNulls` stays off, so a quarter of
 * silence never renders as a straight run of measured progress. A series with
 * a single reading renders as a single dot.
 */
export default function MeasurementTrendChart({
  series,
  height = 280,
}: MeasurementTrendChartProps) {
  // Values are displayed at each metric's own precision, but they share one
  // axis — round only for the tooltip/legend text, never the plotted number.
  const data = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        points: s.points.map((p) => ({
          ...p,
          display: p.value === null ? null : formatMetricValue(p.value, s.decimals),
        })),
      })),
    [series],
  );

  const { domain, useShortDates } = useMemo(() => {
    const times = series.flatMap((s) => s.points.map((p) => p.t));
    if (times.length === 0) {
      return { domain: [0, 1] as [number, number], useShortDates: true };
    }
    let lo = Math.min(...times);
    let hi = Math.max(...times);
    // A single point (or a single day) would collapse the axis — pad it out
    // to a readable week so the dot lands mid-chart instead of on the edge.
    if (hi - lo < 86_400_000) {
      lo -= 3 * 86_400_000;
      hi += 3 * 86_400_000;
    }
    const span = (hi - lo) / 86_400_000;
    return { domain: [lo, hi] as [number, number], useShortDates: span <= 120 };
  }, [series]);

  if (series.length === 0) {
    return (
      <p
        className="text-sm py-10 text-center"
        style={{ color: 'var(--color-text-muted)' }}
        role="status"
      >
        No measurements in this range for the selected metrics.
      </p>
    );
  }

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart margin={CHART_DEFAULTS.margin}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            allowDuplicatedCategory={false}
            tickFormatter={(v: number) =>
              useShortDates
                ? formatUtcDay(new Date(v).toISOString())
                : formatUtcMonthYear(new Date(v).toISOString())
            }
            tick={{ fill: CHART_COLORS.muted, fontSize: 10 }}
            axisLine={{ stroke: CHART_COLORS.grid }}
            tickLine={false}
            minTickGap={30}
          />
          <YAxis
            tick={{ fill: CHART_COLORS.muted, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={40}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => String(Math.round(v * 10) / 10)}
          />
          <Tooltip content={<MeasurementTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: '11px', color: CHART_COLORS.muted, paddingTop: 8 }}
          />
          {data.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey="value"
              data={s.points}
              name={s.unit ? `${s.label} (${s.unit})` : s.label}
              stroke={s.color}
              strokeWidth={CHART_DEFAULTS.strokeWidth}
              connectNulls={false}
              dot={{ r: CHART_DEFAULTS.dotRadius, fill: s.color, strokeWidth: 0 }}
              activeDot={{
                r: CHART_DEFAULTS.activeDotRadius,
                fill: s.color,
                stroke: CHART_COLORS.cardBg,
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
