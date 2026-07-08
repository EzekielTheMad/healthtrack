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
  ReferenceArea,
  Dot,
} from 'recharts';
import {
  CHART_COLORS,
  CHART_DEFAULTS,
  REFERENCE_AREA_OPACITY,
  getVitalDotColor,
} from '@/lib/chart-config';
import ChartTooltip from '@/components/shared/ChartTooltip';

interface VitalDataPoint {
  value: number;
  recorded_at: string;
}

interface VitalTrendChartProps {
  data: VitalDataPoint[];
  metricKey: string;
  label: string;
  refLow?: number;
  refHigh?: number;
  unit?: string;
}

/**
 * Formats a date string for the X axis.
 * Uses "MMM d" for ranges under ~90 days, "MMM yyyy" for longer ranges.
 */
function formatAxisDate(dateStr: string, useShort: boolean): string {
  const d = new Date(dateStr);
  if (useShort) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** Custom dot renderer with range-aware coloring */
function VitalDot(props: {
  cx?: number;
  cy?: number;
  payload?: VitalDataPoint;
  refLow?: number;
  refHigh?: number;
}) {
  const { cx, cy, payload, refLow, refHigh } = props;
  if (cx === undefined || cy === undefined || !payload) return null;

  const color = getVitalDotColor(payload.value, refLow, refHigh);

  return (
    <circle
      cx={cx}
      cy={cy}
      r={CHART_DEFAULTS.dotRadius}
      fill={color}
      stroke={CHART_COLORS.cardBg}
      strokeWidth={1.5}
    />
  );
}

export default function VitalTrendChart({
  data,
  label,
  refLow,
  refHigh,
  unit,
}: VitalTrendChartProps) {
  const sorted = useMemo(
    () =>
      [...data].sort(
        (a, b) =>
          new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
      ),
    [data],
  );

  const useShortDateFormat = useMemo(() => {
    if (sorted.length < 2) return true;
    const first = new Date(sorted[0].recorded_at).getTime();
    const last = new Date(sorted[sorted.length - 1].recorded_at).getTime();
    const daysDiff = (last - first) / (1000 * 60 * 60 * 24);
    return daysDiff <= 90;
  }, [sorted]);

  const chartData = useMemo(
    () =>
      sorted.map((d) => ({
        value: d.value,
        date: d.recorded_at,
        // Keep original for tooltip
        recorded_at: d.recorded_at,
      })),
    [sorted],
  );

  // Compute Y domain with padding around data + reference range
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100] as [number, number];
    const values = chartData.map((d) => d.value);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (refLow !== undefined && refLow < lo) lo = refLow;
    if (refHigh !== undefined && refHigh > hi) hi = refHigh;
    const padding = (hi - lo) * 0.15 || 5;
    return [Math.max(0, lo - padding), hi + padding] as [number, number];
  }, [chartData, refLow, refHigh]);

  if (sorted.length === 0) {
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
        {label}
        {unit ? ` (${unit})` : ''}
      </p>
      <ResponsiveContainer width="100%" height={CHART_DEFAULTS.height - 20}>
        <LineChart
          data={chartData}
          margin={CHART_DEFAULTS.margin}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_COLORS.grid}
            vertical={false}
          />

          <XAxis
            dataKey="date"
            tickFormatter={(v) => formatAxisDate(v, useShortDateFormat)}
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
            width={36}
            tickFormatter={(v: number) => String(Math.round(v))}
          />

          <Tooltip
            content={
              <ChartTooltip
                unit={unit}
                refLow={refLow}
                refHigh={refHigh}
                formatDate={(d) =>
                  new Date(d).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })
                }
              />
            }
          />

          {/* Reference range shading */}
          {refLow !== undefined && refHigh !== undefined && (
            <ReferenceArea
              y1={refLow}
              y2={refHigh}
              fill={CHART_COLORS.sage}
              fillOpacity={REFERENCE_AREA_OPACITY}
              ifOverflow="extendDomain"
            />
          )}

          <Line
            type="monotone"
            dataKey="value"
            stroke={CHART_COLORS.sage}
            strokeWidth={CHART_DEFAULTS.strokeWidth}
            dot={(dotProps) => (
              <VitalDot
                key={`dot-${dotProps.index}`}
                cx={dotProps.cx}
                cy={dotProps.cy}
                payload={dotProps.payload as VitalDataPoint}
                refLow={refLow}
                refHigh={refHigh}
              />
            )}
            activeDot={{
              r: CHART_DEFAULTS.activeDotRadius,
              fill: CHART_COLORS.sage,
              stroke: CHART_COLORS.cardBg,
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
