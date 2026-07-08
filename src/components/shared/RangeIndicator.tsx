'use client';

import React from 'react';

interface RangeIndicatorProps {
  value: number;
  low: number;
  high: number;
  unit: string;
  label: string;
}

export default function RangeIndicator({ value, low, high, unit, label }: RangeIndicatorProps) {
  const rangeSpan = high - low;
  const padding = rangeSpan * 0.3;
  const barMin = low - padding;
  const barMax = high + padding;
  const barSpan = barMax - barMin;

  const clampedValue = Math.max(barMin, Math.min(barMax, value));
  const position = ((clampedValue - barMin) / barSpan) * 100;

  const isInRange = value >= low && value <= high;
  const isLow = value < low;

  let indicatorColor = 'var(--color-sage)'; // green, in range
  if (!isInRange) {
    indicatorColor = isLow ? 'var(--color-warning)' : 'var(--color-terracotta)'; // yellow if low, red if high
  }

  const normalStart = ((low - barMin) / barSpan) * 100;
  const normalWidth = ((high - low) / barSpan) * 100;

  return (
    <div
      className="w-full"
      role="img"
      aria-label={`${label} ${value} ${unit}, normal range ${low} to ${high}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </span>
        <span className="text-sm font-mono font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {value} {unit}
        </span>
      </div>

      <div
        className="relative w-full h-3 rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--color-cream)' }}
      >
        {/* Normal range zone */}
        <div
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${normalStart}%`,
            width: `${normalWidth}%`,
            background: 'linear-gradient(90deg, var(--color-sage-light), var(--color-sage))',
            opacity: 0.3,
          }}
        />

        {/* Value indicator */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2"
          style={{
            left: `calc(${position}% - 6px)`,
            backgroundColor: indicatorColor,
            borderColor: 'var(--bg-primary)',
          }}
        />
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
          {low}
        </span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
          {high}
        </span>
      </div>
    </div>
  );
}
