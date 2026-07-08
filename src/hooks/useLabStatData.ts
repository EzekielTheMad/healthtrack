'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import type { Flag, LabResult } from '@/lib/types';

export interface LabStatDataPoint {
  testName: string;
  latestValue: number;
  unit: string | null;
  flag: Flag | null;
  refLow: number | null;
  refHigh: number | null;
  sparklineData: { value: number; date: string }[];
}

interface LabResultWithVisitDate extends LabResult {
  visit_date: string;
}

/**
 * Fetches lab result data for specific test names to render dashboard stat
 * cards. Returns the latest value, sparkline trend data, and reference ranges.
 * Historical behavior preserved: reads the user's own rows without a
 * dependent filter (dependent_id=all), newest created_at first.
 */
export function useLabStatData(testNames: string[]) {
  const [data, setData] = useState<LabStatDataPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (testNames.length === 0) {
      setData([]);
      return;
    }

    let cancelled = false;

    async function fetchLabData() {
      setLoading(true);

      try {
        const params = new URLSearchParams({
          dependent_id: 'all',
          tests: testNames.join(','),
        });
        const results = await apiFetch<LabResultWithVisitDate[]>(
          `/api/labs/results?${params.toString()}`,
        );

        if (cancelled) return;

        // Group by test_name (rows arrive created_at desc)
        const grouped = new Map<string, LabResultWithVisitDate[]>();
        for (const row of results) {
          const group = grouped.get(row.test_name) ?? [];
          group.push(row);
          grouped.set(row.test_name, group);
        }

        const points: LabStatDataPoint[] = [];
        for (const testName of testNames) {
          const rows = grouped.get(testName);
          if (!rows || rows.length === 0) continue;

          const latest = rows[0];
          // Use visit_date for sparkline x-axis if available
          const sparklineData = rows.slice(0, 7).map((r) => ({
            value: r.value,
            date: r.visit_date ?? r.created_at,
          }));

          points.push({
            testName,
            latestValue: latest.value,
            unit: latest.unit,
            flag: latest.flag,
            refLow: latest.reference_range_low,
            refHigh: latest.reference_range_high,
            sparklineData,
          });
        }

        setData(points);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLabData();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testNames.join(',')]);

  return { labStatData: data, labStatLoading: loading };
}
