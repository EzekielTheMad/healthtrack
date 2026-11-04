'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useDateRange, type DatePreset, type DateRange } from '@/hooks/useDateRange';
import { apiFetch } from '@/lib/api/client';

interface DateRangeContextType {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  activePreset: DatePreset;
  setPreset: (preset: DatePreset) => void;
  reportingTimeZone: string | null;
  calendarLoading: boolean;
  calendarError: string | null;
}

const DateRangeContext = createContext<DateRangeContextType | null>(null);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  // 1M default — 6M rendered ~90 unreadable bars per bar chart on /vitals.
  const value = useDateRange('1m');
  const [reportingTimeZone, setReportingTimeZone] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timeout = setTimeout(() => controller.abort(), 8000);
    apiFetch<{ timezone: string }>('/api/build', { signal: controller.signal })
      .then(({ timezone }) => {
        // Validate metadata before using it in every browser calendar formatter.
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
        if (!timezone) throw new Error('Missing reporting timezone');
        if (!cancelled) setReportingTimeZone(timezone);
      })
      .catch(() => {
        if (cancelled) return;
        setReportingTimeZone('Etc/UTC');
        setCalendarError(
          'Reporting timezone unavailable. Showing calendar days in UTC; reload to retry.'
        );
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return (
    <DateRangeContext.Provider
      value={{
        ...value,
        reportingTimeZone,
        calendarLoading: reportingTimeZone === null,
        calendarError,
      }}
    >
      {calendarError && (
        <p role="status" className="px-4 py-2 text-sm" style={{ color: 'var(--color-warning)' }}>
          {calendarError}
        </p>
      )}
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRangeContext() {
  const context = useContext(DateRangeContext);
  if (!context) {
    throw new Error('useDateRangeContext must be used within a DateRangeProvider');
  }
  return context;
}
