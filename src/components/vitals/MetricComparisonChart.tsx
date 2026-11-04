'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_COLORS, CHART_DEFAULTS } from '@/lib/chart-config';
import { formatUtcDay, formatUtcDayYear } from '@/lib/dates';
import type { ComparisonMetric } from '@/lib/metrics/comparison-types';
import { comparisonValue, type ComparisonPoint } from './comparison-view';

interface Props {
  points: ComparisonPoint[];
  left: ComparisonMetric;
  right: ComparisonMetric;
}

export default function MetricComparisonChart({ points, left, right }: Props) {
  return (
    <div
      role="img"
      aria-label={`${left.label} on the left axis and ${right.label} on the right axis, by calendar date. Gaps mean no data. Exact values are in the data table.`}
    >
      <div className="grid grid-cols-2 gap-4 text-xs mb-3">
        <p style={{ color: CHART_COLORS.sage }}>
          Left axis: {left.label}
          {left.unit ? ` (${left.unit})` : ''}
        </p>
        <p className="text-right" style={{ color: CHART_COLORS.terracotta }}>
          Right axis: {right.label}
          {right.unit ? ` (${right.unit})` : ''}
        </p>
      </div>
      <div className="min-w-0" style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            data={points}
            margin={{ top: 10, right: 0, bottom: 8, left: 0 }}
            accessibilityLayer
          >
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatUtcDay}
              tick={{ fill: CHART_COLORS.muted, fontSize: 10 }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              yAxisId="left"
              width={42}
              domain={['auto', 'auto']}
              tick={{ fill: CHART_COLORS.sage, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              width={42}
              domain={['auto', 'auto']}
              tick={{ fill: CHART_COLORS.terracotta, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              filterNull={false}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as ComparisonPoint | undefined;
                if (!point) return null;
                return (
                  <div
                    className="rounded-lg border p-3 text-xs"
                    style={{
                      backgroundColor: CHART_COLORS.cardBg,
                      borderColor: CHART_COLORS.cardBorder,
                      color: CHART_COLORS.textPrimary,
                    }}
                  >
                    <p className="mb-1">{formatUtcDayYear(String(label))}</p>
                    <p>
                      {left.label}: {comparisonValue(point.left, left.unit)}
                    </p>
                    <p>
                      {right.label}: {comparisonValue(point.right, right.unit)}
                    </p>
                  </div>
                );
              }}
            />
            <Line
              yAxisId="left"
              name={left.label}
              type="linear"
              dataKey="left"
              stroke={CHART_COLORS.sage}
              strokeWidth={CHART_DEFAULTS.strokeWidth}
              dot={{ r: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="right"
              name={right.label}
              type="linear"
              dataKey="right"
              stroke={CHART_COLORS.terracotta}
              strokeWidth={CHART_DEFAULTS.strokeWidth}
              strokeDasharray="5 3"
              dot={{ r: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
