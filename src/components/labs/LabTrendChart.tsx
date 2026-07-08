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
} from 'recharts';
import {
  CHART_COLORS,
  CHART_DEFAULTS,
  REFERENCE_AREA_OPACITY,
  getLabDotColor,
} from '@/lib/chart-config';
import ChartTooltip from '@/components/shared/ChartTooltip';

interface LabDataPoint {
  value: number;
  date: string;
  flag: string;
  refLow?: number | null;
  refHigh?: number | null;
}

interface LabTrendChartProps {
  data: LabDataPoint[];
  testName: string;
  unit?: string;
}

/**
 * Formats a date string for the X axis.
 * Uses "MMM d" for ranges ≤90 days, "MMM yyyy" for longer.
 */
function formatAxisDate(dateStr: string, useShort: boolean): string {
  const d = new Date(dateStr);
  if (useShort) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** Custom dot renderer with flag-aware coloring */
function LabDot(props: {
  cx?: number;
  cy?: number;
  payload?: LabDataPoint;
}) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;

  const color = getLabDotColor(payload.flag);

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

export default function LabTrendChart({
  data,
  testName,
  unit,
}: LabTrendChartProps) {
  const sorted = useMemo(
    () =>
      [...data].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      ),
    [data],
  );

  const useShortDateFormat = useMemo(() => {
    if (sorted.length < 2) return true;
    const first = new Date(sorted[0].date).getTime();
    const last = new Date(sorted[sorted.length - 1].date).getTime();
    const daysDiff = (last - first) / (1000 * 60 * 60 * 24);
    return daysDiff <= 90;
  }, [sorted]);

  // Use the most common (or latest) reference range for the shading band
  const { refLow, refHigh } = useMemo(() => {
    // Use the latest result's ref range
    const latest = sorted[sorted.length - 1];
    return {
      refLow: latest?.refLow ?? undefined,
      refHigh: latest?.refHigh ?? undefined,
    };
  }, [sorted]);

  const yDomain = useMemo(() => {
    if (sorted.length === 0) return [0, 100] as [number, number];
    const values = sorted.map((d) => d.value);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    // Incorporate all ref ranges seen in data
    for (const d of sorted) {
      if (d.refLow != null && d.refLow < lo) lo = d.refLow;
      if (d.refHigh != null && d.refHigh > hi) hi = d.refHigh;
    }
    const padding = (hi - lo) * 0.15 || 5;
    return [Math.max(0, lo - padding), hi + padding] as [number, number];
  }, [sorted]);

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
        {testName}
        {unit ? ` (${unit})` : ''}
      </p>
      <ResponsiveContainer width="100%" height={CHART_DEFAULTS.height - 20}>
        <LineChart data={sorted} margin={CHART_DEFAULTS.margin}>
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
                refLow={refLow !== null ? refLow : undefined}
                refHigh={refHigh !== null ? refHigh : undefined}
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

          {/* Reference range shading from latest result's range */}
          {refLow != null && refHigh != null && (
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
              <LabDot
                key={`dot-${dotProps.index}`}
                cx={dotProps.cx}
                cy={dotProps.cy}
                payload={dotProps.payload as LabDataPoint}
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
