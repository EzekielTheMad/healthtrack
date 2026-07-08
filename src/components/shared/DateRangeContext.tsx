'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useDateRange, type DatePreset, type DateRange } from '@/hooks/useDateRange';

interface DateRangeContextType {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  activePreset: DatePreset;
  setPreset: (preset: DatePreset) => void;
}

const DateRangeContext = createContext<DateRangeContextType | null>(null);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const value = useDateRange('6m');

  return (
    <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>
  );
}

export function useDateRangeContext() {
  const context = useContext(DateRangeContext);
  if (!context) {
    throw new Error('useDateRangeContext must be used within a DateRangeProvider');
  }
  return context;
}
