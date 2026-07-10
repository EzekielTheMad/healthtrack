'use client';

import React from 'react';

interface RangeIndicatorProps {
  value: number;
  /** Null for one-sided "anything at or below high is normal" ranges (BP
      normal, AHI) — rendered as "≤ high" with the band anchored at the left
      edge instead of fabricating a 0 lower bound. */
  low: number | null;
  high: number;
  unit: string;
  label: string;
  /** Formatted value text (registry decimals); defaults to the raw value. */
  displayValue?: string;
}

export default function RangeIndicator({
  value,
  low,
  high,
  unit,
  label,
  displayValue,
}: RangeIndicatorProps) {
  const oneSided = low === null;
  // One-sided bars anchor at the smaller of 0 and the value; two-sided bars
  // pad 30% of the range on each side.
  const rangeSpan = oneSided ? high - Math.min(0, value) : high - low;
  const padding = rangeSpan * 0.3;
  const barMin = oneSided ? Math.min(0, value) : low - padding;
  const barMax = high + padding;
  const barSpan = barMax - barMin;

  const clampedValue = Math.max(barMin, Math.min(barMax, value));
  const position = ((clampedValue - barMin) / barSpan) * 100;

  const isInRange = value <= high && (oneSided || value >= low);
  const isLow = !oneSided && value < low;

  let indicatorColor = 'var(--color-sage)'; // green, in range
  if (!isInRange) {
    indicatorColor = isLow ? 'var(--color-warning)' : 'var(--color-terracotta)'; // yellow if low, red if high
  }

  const normalStart = oneSided ? 0 : ((low - barMin) / barSpan) * 100;
  const normalWidth = ((high - (oneSided ? barMin : low)) / barSpan) * 100;

  const valueText = displayValue ?? String(value);
  const rangeText = oneSided ? `${high} or below` : `${low} to ${high}`;

  return (
    <div
      className="w-full"
      role="img"
      aria-label={`${label ? `${label} ` : ''}${valueText} ${unit}, normal range ${rangeText}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </span>
        <span className="text-sm font-mono font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {valueText} {unit}
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
          {oneSided ? '' : low}
        </span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
          {oneSided ? `≤ ${high}` : high}
        </span>
      </div>
    </div>
  );
}
