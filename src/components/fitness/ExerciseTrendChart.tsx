'use client';

import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { CHART_COLORS, CHART_DEFAULTS } from '@/lib/chart-config';
import { formatMetricValue } from '@/lib/metrics/format';
import type { TrendPoint } from '@/lib/fitness/trends';

// ---------------------------------------------------------------------------
// Working-weight-over-time chart for one exercise, modeled on
// VitalTrendChart's recharts conventions: sage primary line with dots, a
// dashed muted secondary e1RM line (weight mode only), and a PR badge on any
// point that sets a new max. Session timestamps are real instants, so axis
// labels render in local time (the intraday convention).
// ---------------------------------------------------------------------------

interface ExerciseTrendChartProps {
  points: TrendPoint[];
  mode: 'weight' | 'time';
}

function formatAxisDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Dot renderer: sage dot; PR points get a warning-gold dot + "PR" badge. */
function TrendDot(props: { cx?: number; cy?: number; payload?: TrendPoint }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  if (!payload.isPr) {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={CHART_DEFAULTS.dotRadius}
        fill={CHART_COLORS.sage}
        stroke={CHART_COLORS.cardBg}
        strokeWidth={1.5}
      />
    );
  }
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={CHART_DEFAULTS.dotRadius + 1}
        fill={CHART_COLORS.warning}
        stroke={CHART_COLORS.cardBg}
        strokeWidth={1.5}
      />
      <text
        x={cx}
        y={cy - 9}
        textAnchor="middle"
        fill={CHART_COLORS.warning}
        fontSize={9}
        fontWeight={700}
        fontFamily="monospace"
      >
        PR
      </text>
    </g>
  );
}

interface TooltipContentProps {
  active?: boolean;
  payload?: Array<{ payload?: TrendPoint }>;
  label?: string;
  unit: string;
}

function TrendTooltip({ active, payload, label, unit }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  if (!point) return null;
  return (
    <div
      style={{
        backgroundColor: CHART_COLORS.cardBg,
        border: `1px solid ${CHART_COLORS.cardBorder}`,
        borderRadius: '8px',
        padding: '10px 14px',
        minWidth: '120px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
      }}
    >
      <p style={{ color: CHART_COLORS.muted, fontSize: '11px', margin: '0 0 4px 0' }}>
        {label
          ? new Date(label).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })
          : ''}
      </p>
      <p
        style={{
          color: CHART_COLORS.textPrimary,
          fontSize: '16px',
          fontWeight: 700,
          fontFamily: 'monospace',
          margin: 0,
        }}
      >
        {formatMetricValue(point.value, 1)}
        <span style={{ color: CHART_COLORS.muted, fontSize: '11px', fontWeight: 400, marginLeft: '4px' }}>
          {unit}
        </span>
      </p>
      {point.e1rm !== null && (
        <p style={{ color: CHART_COLORS.muted, fontSize: '11px', margin: '4px 0 0 0' }}>
          e1RM {formatMetricValue(point.e1rm, 1)} {unit}
        </p>
      )}
      {point.isPr && (
        <p style={{ color: CHART_COLORS.warning, fontSize: '11px', fontWeight: 600, margin: '4px 0 0 0' }}>
          New PR
        </p>
      )}
    </div>
  );
}

export default function ExerciseTrendChart({ points, mode }: ExerciseTrendChartProps) {
  const unit = mode === 'time' ? 'sec' : 'lb';
  const hasE1rm = mode === 'weight' && points.some((p) => p.e1rm !== null);

  const yDomain = useMemo(() => {
    if (points.length === 0) return [0, 100] as [number, number];
    const values = points.flatMap((p) => (p.e1rm !== null ? [p.value, p.e1rm] : [p.value]));
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const padding = (hi - lo) * 0.15 || 5;
    return [Math.max(0, lo - padding), hi + padding] as [number, number];
  }, [points]);

  if (points.length === 0) {
    return (
      <div
        style={{
          height: CHART_DEFAULTS.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: CHART_COLORS.muted,
          fontSize: '13px',
        }}
      >
        No data available
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: CHART_DEFAULTS.height }}>
      <p
        style={{
          color: CHART_COLORS.muted,
          fontSize: '11px',
          marginBottom: '4px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {mode === 'time' ? `Top seconds (${unit})` : `Working weight (${unit})`}
      </p>
      <ResponsiveContainer width="100%" height={CHART_DEFAULTS.height - 20}>
        <LineChart data={points} margin={CHART_DEFAULTS.margin}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatAxisDate}
            tick={{ fill: CHART_COLORS.muted, fontSize: 10 }}
            axisLine={{ stroke: CHART_COLORS.grid }}
            tickLine={false}
            minTickGap={30}
          />
          <YAxis
            domain={yDomain}
            tick={{ fill: CHART_COLORS.muted, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v: number) => String(Math.round(v))}
          />
          <Tooltip content={<TrendTooltip unit={unit} />} />
          {hasE1rm && (
            <Legend
              wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted }}
              iconSize={10}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            name={mode === 'time' ? 'Top seconds' : 'Working weight'}
            stroke={CHART_COLORS.sage}
            strokeWidth={CHART_DEFAULTS.strokeWidth}
            dot={(dotProps) => (
              <TrendDot
                key={`dot-${dotProps.index}`}
                cx={dotProps.cx}
                cy={dotProps.cy}
                payload={dotProps.payload as TrendPoint}
              />
            )}
            activeDot={{
              r: CHART_DEFAULTS.activeDotRadius,
              fill: CHART_COLORS.sage,
              stroke: CHART_COLORS.cardBg,
              strokeWidth: 2,
            }}
          />
          {hasE1rm && (
            <Line
              type="monotone"
              dataKey="e1rm"
              name="e1RM (Epley)"
              stroke={CHART_COLORS.muted}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              activeDot={false}
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
