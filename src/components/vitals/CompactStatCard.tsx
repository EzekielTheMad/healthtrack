'use client';

import React from 'react';
import SourceBadge from '@/components/shared/SourceBadge';
import RangeIndicator from '@/components/shared/RangeIndicator';
import { formatVitalDate } from '@/lib/dates';
import { getMetric } from '@/lib/metrics/registry';
import {
  displayUnit,
  formatDuration,
  formatMetricValue,
  isDurationMetric,
} from '@/lib/metrics/format';

interface SparklinePoint {
  value: number;
  date: string;
}

interface RangeInfo {
  /** Null for one-sided "below high is normal" ranges (BP normal, AHI). */
  low: number | null;
  high: number;
}

interface CompactStatCardProps {
  label: string;
  value: number;
  unit: string;
  source: string;
  timestamp: string;
  /** Registry key — drives date/value formatting and trend direction. */
  metricKey: string;
  /** Rendered instead of the numeric value (ordinal metrics show their label text). */
  displayValue?: string;
  sparklineData?: SparklinePoint[];
  rangeInfo?: RangeInfo;
  /** When set, the card is a button toggling its expanded chart panel. */
  onClick?: () => void;
  /** Whether this card's expanded panel is currently open. */
  expanded?: boolean;
}

function Sparkline({
  data,
  goalDirection,
}: {
  data: SparklinePoint[];
  goalDirection?: 'higher' | 'lower';
}) {
  if (data.length < 2) return null;

  const sorted = [...data].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const values = sorted.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const width = 80;
  const height = 24;
  const padding = 2;
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;

  const points = sorted
    .map((d, i) => {
      const x = padding + (i / (sorted.length - 1)) * usableW;
      const y = padding + usableH - ((d.value - min) / range) * usableH;
      return `${x},${y}`;
    })
    .join(' ');

  // Trend color from last vs first, judged by the metric's goalDirection —
  // for lower-is-better metrics a falling line is the good direction.
  // Metrics without a direction stay neutral.
  const first = values[0];
  const last = values[values.length - 1];
  let strokeColor = 'var(--color-text-muted)'; // neutral
  if (goalDirection !== undefined && last !== first) {
    const improved = (last > first) === (goalDirection === 'higher');
    strokeColor = improved ? 'var(--color-sage)' : 'var(--color-terracotta)';
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
      {/* Highlight last point */}
      {sorted.length > 0 && (() => {
        const lastIdx = sorted.length - 1;
        const x = padding + (lastIdx / (sorted.length - 1)) * usableW;
        const y =
          padding + usableH - ((sorted[lastIdx].value - min) / range) * usableH;
        return <circle cx={x} cy={y} r={2} fill={strokeColor} />;
      })()}
    </svg>
  );
}

export default function CompactStatCard({
  label,
  value,
  unit,
  source,
  timestamp,
  metricKey,
  displayValue,
  sparklineData,
  rangeInfo,
  onClick,
  expanded,
}: CompactStatCardProps) {
  const metric = getMetric(metricKey);
  const duration = isDurationMetric(metric);
  // Clamp raw stored floats to the registry decimals; minute-based sleep
  // metrics render as h/m durations (with the unit folded into the text).
  const valueText =
    displayValue ??
    (duration ? formatDuration(value) : formatMetricValue(value, metric?.decimals ?? 1));
  const unitText = duration ? '' : displayUnit(unit || (metric?.unit ?? null));

  const isInRange =
    rangeInfo != null
      ? value <= rangeInfo.high && (rangeInfo.low === null || value >= rangeInfo.low)
      : true;
  const isLow = rangeInfo != null && rangeInfo.low !== null && value < rangeInfo.low;

  let valueColor = 'var(--color-text-primary)';
  if (rangeInfo != null) {
    if (isInRange) valueColor = 'var(--color-sage)';
    else if (isLow) valueColor = 'var(--color-warning)';
    else valueColor = 'var(--color-terracotta)';
  }

  const Wrapper: 'button' | 'div' = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick
        ? {
            type: 'button' as const,
            onClick,
            'aria-expanded': expanded === true,
            'aria-label': `${label} — ${expanded ? 'hide' : 'show'} chart`,
          }
        : {})}
      className={`rounded-xl border p-4 flex flex-col gap-2 text-left w-full${
        onClick ? ' cursor-pointer transition-colors' : ''
      }`}
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: expanded ? 'var(--color-sage)' : 'var(--border-card)',
      }}
    >
      {/* Header: label + source badge */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </span>
        <SourceBadge source={source} />
      </div>

      {/* Value + sparkline row */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-2xl font-mono font-semibold"
            style={{ color: valueColor }}
          >
            {valueText}
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {unitText}
          </span>
        </div>
        {sparklineData && sparklineData.length >= 2 && (
          <Sparkline data={sparklineData} goalDirection={metric?.goalDirection} />
        )}
      </div>

      {/* Range indicator */}
      {rangeInfo && (
        <RangeIndicator
          value={value}
          displayValue={valueText}
          low={rangeInfo.low}
          high={rangeInfo.high}
          unit={unitText}
          label=""
        />
      )}

      {/* Timestamp */}
      <time
        className="text-[11px]"
        style={{ color: 'var(--color-text-muted)' }}
        dateTime={timestamp}
      >
        {formatVitalDate(timestamp, metricKey)}
      </time>
    </Wrapper>
  );
}
