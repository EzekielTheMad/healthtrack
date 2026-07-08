'use client';

import React from 'react';

interface TrendLineProps {
  data: Array<{ value: number; date: string }>;
  refLow?: number;
  refHigh?: number;
  width?: number;
  height?: number;
}

export default function TrendLine({
  data,
  refLow,
  refHigh,
  width = 200,
  height = 60,
}: TrendLineProps) {
  if (data.length === 0) return null;

  const sorted = [...data].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const values = sorted.map((d) => d.value);
  const allValues = [...values];
  if (refLow !== undefined) allValues.push(refLow);
  if (refHigh !== undefined) allValues.push(refHigh);

  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;

  const padding = { top: 6, bottom: 6, left: 4, right: 4 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const scaleX = (i: number) =>
    padding.left + (sorted.length === 1 ? chartW / 2 : (i / (sorted.length - 1)) * chartW);
  const scaleY = (v: number) =>
    padding.top + chartH - ((v - minVal) / range) * chartH;

  const points = sorted.map((d, i) => ({
    x: scaleX(i),
    y: scaleY(d.value),
    value: d.value,
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
    .join(' ');

  // Reference range band
  const hasRefBand = refLow !== undefined && refHigh !== undefined;
  const refBandY1 = refHigh !== undefined ? scaleY(refHigh) : 0;
  const refBandY2 = refLow !== undefined ? scaleY(refLow) : height;

  const getPointColor = (value: number): string => {
    if (refLow !== undefined && value < refLow) return 'var(--color-warning)';
    if (refHigh !== undefined && value > refHigh) return 'var(--color-terracotta)';
    return 'var(--color-sage)';
  };

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Reference range band */}
      {hasRefBand && (
        <rect
          x={padding.left}
          y={refBandY1}
          width={chartW}
          height={Math.max(0, refBandY2 - refBandY1)}
          fill="var(--color-sage)"
          opacity={0.08}
          rx={2}
        />
      )}

      {/* Gradient fill under line */}
      <defs>
        <linearGradient id={`warmGradient-${width}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-sage)" stopOpacity={0.25} />
          <stop offset="100%" stopColor="var(--color-sage)" stopOpacity={0} />
        </linearGradient>
      </defs>
      {points.length >= 2 && (
        <path
          d={`${linePath} L${points[points.length - 1].x},${padding.top + chartH} L${points[0].x},${padding.top + chartH} Z`}
          fill={`url(#warmGradient-${width})`}
        />
      )}

      {/* Line */}
      <path d={linePath} fill="none" stroke="var(--color-sage)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* Points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={3}
          fill={getPointColor(p.value)}
          stroke="var(--bg-primary)"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}
