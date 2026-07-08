'use client';

import React, { useMemo, useRef, useState } from 'react';

interface BarChartDataPoint {
  value: number;
  date: string;
  label?: string;
}

interface BarChartProps {
  data: BarChartDataPoint[];
  color?: string;
  height?: number;
  refLow?: number;
  refHigh?: number;
}

function abbreviateDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getBarColor(value: number, refLow?: number, refHigh?: number): string {
  if (refLow == null || refHigh == null) return 'var(--color-sage)'; // sage default
  if (value >= refLow && value <= refHigh) return 'var(--color-sage)'; // green in range
  if (value < refLow) return 'var(--color-warning)'; // yellow low
  return 'var(--color-terracotta)'; // red high
}

export default function BarChart({
  data,
  color,
  height = 200,
  refLow,
  refHigh,
}: BarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const sorted = useMemo(
    () => [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [data],
  );

  const { maxVal, minVal } = useMemo(() => {
    if (sorted.length === 0) return { maxVal: 100, minVal: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of sorted) {
      if (d.value < lo) lo = d.value;
      if (d.value > hi) hi = d.value;
    }
    if (refLow != null && refLow < lo) lo = refLow;
    if (refHigh != null && refHigh > hi) hi = refHigh;
    // Add 10% padding
    const range = hi - lo || 1;
    return { maxVal: hi + range * 0.1, minVal: Math.max(0, lo - range * 0.1) };
  }, [sorted, refLow, refHigh]);

  if (sorted.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border"
        style={{ height, backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)', color: 'var(--color-text-muted)' }}
      >
        <span className="text-sm">No data available</span>
      </div>
    );
  }

  const paddingLeft = 44;
  const paddingRight = 12;
  const paddingTop = 16;
  const paddingBottom = 32;
  const chartHeight = height - paddingTop - paddingBottom;
  const viewBoxWidth = 600;
  const chartWidth = viewBoxWidth - paddingLeft - paddingRight;

  const barCount = sorted.length;
  const gap = Math.max(2, Math.min(8, chartWidth / barCount * 0.2));
  const barWidth = Math.max(4, (chartWidth - gap * (barCount - 1)) / barCount);

  function yPos(val: number): number {
    const ratio = (val - minVal) / (maxVal - minVal);
    return paddingTop + chartHeight * (1 - ratio);
  }

  // Reference band
  const refBandY = refHigh != null ? yPos(refHigh) : 0;
  const refBandHeight =
    refLow != null && refHigh != null ? yPos(refLow) - yPos(refHigh) : 0;

  return (
    <div ref={containerRef} className="w-full">
      <svg
        viewBox={`0 0 ${viewBoxWidth} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Bar chart"
        style={{ display: 'block' }}
      >
        {/* Reference range band */}
        {refLow != null && refHigh != null && refBandHeight > 0 && (
          <rect
            x={paddingLeft}
            y={refBandY}
            width={chartWidth}
            height={refBandHeight}
            rx={2}
            fill="var(--color-sage)"
            opacity={0.08}
          />
        )}

        {/* Y-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const val = minVal + (maxVal - minVal) * frac;
          const y = yPos(val);
          return (
            <g key={frac}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={viewBoxWidth - paddingRight}
                y2={y}
                stroke="var(--border-card)"
                strokeWidth={1}
              />
              <text
                x={paddingLeft - 6}
                y={y + 3}
                textAnchor="end"
                fill="var(--color-text-muted)"
                fontSize={9}
                fontFamily="monospace"
              >
                {Math.round(val)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {sorted.map((d, i) => {
          const x = paddingLeft + i * (barWidth + gap);
          const barH = Math.max(2, ((d.value - minVal) / (maxVal - minVal)) * chartHeight);
          const y = paddingTop + chartHeight - barH;
          const barColor = color ?? getBarColor(d.value, refLow, refHigh);
          const isHovered = hoveredIndex === i;
          const radius = Math.min(barWidth / 2, 4);

          return (
            <g
              key={d.date + i}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              role="graphics-symbol"
              aria-label={`${d.label ?? abbreviateDate(d.date)}: ${d.value}`}
            >
              {/* Bar with rounded top via clipPath trick */}
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={radius}
                ry={radius}
                fill={barColor}
                opacity={isHovered ? 1 : 0.8}
                style={{ transition: 'opacity 0.15s' }}
              />
              {/* Square off bottom corners */}
              {barH > radius && (
                <rect
                  x={x}
                  y={y + barH - radius}
                  width={barWidth}
                  height={radius}
                  fill={barColor}
                  opacity={isHovered ? 1 : 0.8}
                  style={{ transition: 'opacity 0.15s' }}
                />
              )}

              {/* Hover tooltip */}
              {isHovered && (
                <>
                  <rect
                    x={x + barWidth / 2 - 20}
                    y={y - 22}
                    width={40}
                    height={18}
                    rx={4}
                    fill="var(--bg-primary)"
                    stroke="var(--border-card)"
                    strokeWidth={1}
                  />
                  <text
                    x={x + barWidth / 2}
                    y={y - 10}
                    textAnchor="middle"
                    fill="var(--color-text-primary)"
                    fontSize={10}
                    fontFamily="monospace"
                    fontWeight={600}
                  >
                    {d.value}
                  </text>
                </>
              )}

              {/* X-axis date labels — show every Nth to avoid overlap */}
              {(barCount <= 14 || i % Math.ceil(barCount / 14) === 0) && (
                <text
                  x={x + barWidth / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fill="var(--color-text-muted)"
                  fontSize={8}
                  fontFamily="monospace"
                >
                  {abbreviateDate(d.date)}
                </text>
              )}
            </g>
          );
        })}

        {/* Reference range labels */}
        {refHigh != null && (
          <text
            x={viewBoxWidth - paddingRight - 2}
            y={yPos(refHigh) - 3}
            textAnchor="end"
            fill="var(--color-sage)"
            fontSize={8}
            fontFamily="monospace"
            opacity={0.6}
          >
            {refHigh}
          </text>
        )}
        {refLow != null && (
          <text
            x={viewBoxWidth - paddingRight - 2}
            y={yPos(refLow) + 10}
            textAnchor="end"
            fill="var(--color-sage)"
            fontSize={8}
            fontFamily="monospace"
            opacity={0.6}
          >
            {refLow}
          </text>
        )}
      </svg>
    </div>
  );
}
