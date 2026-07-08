'use client';

import { useCallback, useMemo, useState } from 'react';

export type DatePreset = '7d' | '1m' | '3m' | '6m' | '1y' | 'all';

export interface DateRange {
  start: string | null;
  end: string | null;
}

function computeDateRange(preset: DatePreset): DateRange {
  if (preset === 'all') {
    return { start: null, end: null };
  }

  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now);

  switch (preset) {
    case '7d':
      start.setDate(start.getDate() - 7);
      break;
    case '1m':
      start.setMonth(start.getMonth() - 1);
      break;
    case '3m':
      start.setMonth(start.getMonth() - 3);
      break;
    case '6m':
      start.setMonth(start.getMonth() - 6);
      break;
    case '1y':
      start.setFullYear(start.getFullYear() - 1);
      break;
  }

  return { start: start.toISOString(), end };
}

export function useDateRange(defaultPreset: DatePreset = '6m') {
  const [activePreset, setActivePreset] = useState<DatePreset>(defaultPreset);
  const [customRange, setCustomRange] = useState<DateRange | null>(null);

  const dateRange = useMemo<DateRange>(() => {
    if (customRange) return customRange;
    return computeDateRange(activePreset);
  }, [activePreset, customRange]);

  const setDateRange = useCallback((range: DateRange) => {
    setCustomRange(range);
  }, []);

  const setPreset = useCallback((preset: DatePreset) => {
    setCustomRange(null);
    setActivePreset(preset);
  }, []);

  return { dateRange, setDateRange, activePreset, setPreset };
}
