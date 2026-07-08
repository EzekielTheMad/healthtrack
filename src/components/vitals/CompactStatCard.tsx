'use client';

import React from 'react';
import SourceBadge from '@/components/shared/SourceBadge';
import RangeIndicator from '@/components/shared/RangeIndicator';

interface SparklinePoint {
  value: number;
  date: string;
}

interface RangeInfo {
  low: number;
  high: number;
}

interface CompactStatCardProps {
  label: string;
  value: number;
  unit: string;
  source: string;
  timestamp: string;
  sparklineData?: SparklinePoint[];
  rangeInfo?: RangeInfo;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Sparkline({ data }: { data: SparklinePoint[] }) {
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

  // Determine trend color: compare last to first
  const first = values[0];
  const last = values[values.length - 1];
  let strokeColor = 'var(--color-text-muted)'; // neutral
  if (last > first) strokeColor = 'var(--color-sage)'; // green uptrend
  if (last < first) strokeColor = 'var(--color-terracotta)'; // red downtrend

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
  sparklineData,
  rangeInfo,
}: CompactStatCardProps) {
  const isInRange =
    rangeInfo != null ? value >= rangeInfo.low && value <= rangeInfo.high : true;
  const isLow = rangeInfo != null && value < rangeInfo.low;

  let valueColor = 'var(--color-text-primary)';
  if (rangeInfo != null) {
    if (isInRange) valueColor = 'var(--color-sage)';
    else if (isLow) valueColor = 'var(--color-warning)';
    else valueColor = 'var(--color-terracotta)';
  }

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
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
            {value}
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {unit}
          </span>
        </div>
        {sparklineData && sparklineData.length >= 2 && (
          <Sparkline data={sparklineData} />
        )}
      </div>

      {/* Range indicator */}
      {rangeInfo && (
        <RangeIndicator
          value={value}
          low={rangeInfo.low}
          high={rangeInfo.high}
          unit={unit}
          label=""
        />
      )}

      {/* Timestamp */}
      <time
        className="text-[11px]"
        style={{ color: 'var(--color-text-muted)' }}
        dateTime={timestamp}
      >
        {formatShortDate(timestamp)}
      </time>
    </div>
  );
}
