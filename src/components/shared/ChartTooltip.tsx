'use client';

import React from 'react';
import { CHART_COLORS } from '@/lib/chart-config';

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload?: Record<string, unknown>;
  }>;
  label?: string;
  unit?: string;
  refLow?: number;
  refHigh?: number;
  /** Custom date formatter. Defaults to locale date string. */
  formatDate?: (dateStr: string) => string;
  /** Custom value formatter (registry decimals, durations). Defaults to
      0–1 decimals. */
  formatValue?: (value: number) => string;
}

function getRangeStatus(
  value: number,
  refLow?: number,
  refHigh?: number,
): { label: string; color: string } | null {
  // One-sided ranges ("below refHigh is normal") have no Low band.
  if (refHigh === undefined) return null;
  if (refLow !== undefined && value < refLow) return { label: 'Low', color: CHART_COLORS.warning };
  if (value > refHigh) return { label: 'High', color: CHART_COLORS.terracotta };
  return { label: 'Normal', color: CHART_COLORS.sage };
}

/**
 * Shared custom tooltip for Recharts charts, styled to match the app theme.
 * Shows date, value with optional unit, and optional reference range status.
 */
export default function ChartTooltip({
  active,
  payload,
  label,
  unit,
  refLow,
  refHigh,
  formatDate,
  formatValue,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const value = payload[0].value;
  const rangeStatus = getRangeStatus(value, refLow, refHigh);

  const dateDisplay = label
    ? formatDate
      ? formatDate(label)
      : new Date(label).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
    : '';

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
      {dateDisplay && (
        <p
          style={{
            color: CHART_COLORS.muted,
            fontSize: '11px',
            marginBottom: '4px',
            margin: '0 0 4px 0',
          }}
        >
          {dateDisplay}
        </p>
      )}
      <p
        style={{
          color: CHART_COLORS.textPrimary,
          fontSize: '16px',
          fontWeight: 700,
          fontFamily: 'monospace',
          margin: '0',
        }}
      >
        {typeof value === 'number'
          ? formatValue
            ? formatValue(value)
            : value.toFixed(value % 1 === 0 ? 0 : 1)
          : value}
        {unit && (
          <span
            style={{
              color: CHART_COLORS.muted,
              fontSize: '11px',
              fontWeight: 400,
              marginLeft: '4px',
              fontFamily: 'inherit',
            }}
          >
            {unit}
          </span>
        )}
      </p>
      {rangeStatus && (
        <p
          style={{
            color: rangeStatus.color,
            fontSize: '11px',
            fontWeight: 500,
            margin: '4px 0 0 0',
          }}
        >
          {rangeStatus.label}
        </p>
      )}
    </div>
  );
}
