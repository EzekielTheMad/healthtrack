'use client';

import React from 'react';
import { vitalSourceLabel } from '@/lib/metrics/source-label';

interface SourceBadgeProps {
  source: string;
  metadata?: Record<string, unknown> | null;
}

const colorMap: Record<string, string> = {
  oura: 'var(--source-oura)',
  myair: 'var(--color-sage)',
  samsung: 'var(--source-samsung)',
  fitbit: 'var(--color-sage)',
  manual: 'var(--color-text-muted)',
};

export default function SourceBadge({ source, metadata }: SourceBadgeProps) {
  const key = source.toLowerCase();
  const color = Object.hasOwn(colorMap, key) ? colorMap[key] : 'var(--color-text-muted)';
  const label = vitalSourceLabel(source, metadata);

  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium"
      style={{
        color,
        backgroundColor: `${color}20`,
      }}
      aria-label={`Data source: ${label}`}
      title={source}
    >
      {label}
    </span>
  );
}
