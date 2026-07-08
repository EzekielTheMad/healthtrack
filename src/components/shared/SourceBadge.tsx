'use client';

import React from 'react';

interface SourceBadgeProps {
  source: string;
}

const colorMap: Record<string, string> = {
  oura: 'var(--source-oura)',
  myair: 'var(--color-sage)',
  samsung: 'var(--source-samsung)',
  fitbit: 'var(--color-sage)',
  manual: 'var(--color-text-muted)',
};

export default function SourceBadge({ source }: SourceBadgeProps) {
  const key = source.toLowerCase();
  const color = colorMap[key] ?? 'var(--color-text-muted)';

  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium"
      style={{
        color,
        backgroundColor: `${color}20`,
      }}
      aria-label={`Data source: ${source}`}
    >
      {source}
    </span>
  );
}
