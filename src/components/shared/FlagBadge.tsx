'use client';

import React from 'react';

type Flag = 'normal' | 'high' | 'low' | 'critical';

interface FlagBadgeProps {
  flag: Flag;
}

const flagConfig: Record<Flag, { label: string; color: string; bg: string }> = {
  normal: { label: 'Normal', color: 'var(--color-sage)', bg: 'rgba(129, 178, 154, 0.15)' },
  high: { label: 'High', color: 'var(--color-terracotta)', bg: 'rgba(224, 122, 95, 0.15)' },
  low: { label: 'Low', color: 'var(--color-warning)', bg: 'rgba(233, 196, 106, 0.15)' },
  critical: { label: 'Critical', color: 'var(--color-terracotta)', bg: 'rgba(224, 122, 95, 0.25)' },
};

export default function FlagBadge({ flag }: FlagBadgeProps) {
  const config = flagConfig[flag];

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        flag === 'critical' ? 'font-bold ring-1' : ''
      }`}
      style={{
        color: config.color,
        backgroundColor: config.bg,
        ...(flag === 'critical' ? { ringColor: config.color, boxShadow: `0 0 0 1px ${config.color}` } : {}),
      }}
    >
      {config.label}
    </span>
  );
}
