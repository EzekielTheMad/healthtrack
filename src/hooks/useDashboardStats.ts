'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { DEVICE_DEFAULTS, MANUAL_DEFAULTS, getMetricDefinition } from '@/lib/dashboard-metrics';
import type { DashboardStatPreference, DashboardWidgetType } from '@/lib/types';

interface AvailableLabTest {
  testName: string;
  unit: string | null;
  latestValue: number;
  flag: string | null;
}

interface DashboardStatsResponse {
  preferences: DashboardStatPreference[];
  source_count: number;
  available_lab_tests: Array<{
    test_name: string;
    unit: string | null;
    latest_value: number;
    flag: string | null;
  }>;
}

function statsUrl(dependentId: string | null): string {
  return dependentId
    ? `/api/dashboard-stats?dependent_id=${encodeURIComponent(dependentId)}`
    : '/api/dashboard-stats';
}

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStatPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasCustomized, setHasCustomized] = useState(false);
  const [availableLabTests, setAvailableLabTests] = useState<AvailableLabTest[]>([]);
  const { dependentId } = useActiveProfile();

  // Determine default metric keys based on whether the user has connected sources
  const [defaultKeys, setDefaultKeys] = useState<string[]>(MANUAL_DEFAULTS);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<DashboardStatsResponse>(statsUrl(dependentId));
        if (cancelled) return;

        setDefaultKeys(data.source_count > 0 ? DEVICE_DEFAULTS : MANUAL_DEFAULTS);

        if (data.preferences.length > 0) {
          setStats(data.preferences);
          setHasCustomized(true);
        } else {
          // No saved prefs — user hasn't customized yet
          setHasCustomized(false);
          setStats([]);
        }

        setAvailableLabTests(
          data.available_lab_tests.map((t) => ({
            testName: t.test_name,
            unit: t.unit,
            latestValue: t.latest_value,
            flag: t.flag,
          })),
        );
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load dashboard stats');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStats();
    return () => { cancelled = true; };
  }, [dependentId]);

  /** Get the effective stat list — saved prefs or defaults */
  const effectiveStats = hasCustomized
    ? stats
    : defaultKeys.map((key, i) => {
        const def = getMetricDefinition(key);
        return {
          id: `default-${key}`,
          user_id: '',
          dependent_id: dependentId,
          widget_type: 'vital' as DashboardWidgetType,
          metric_key: key,
          position: i,
          pinned: false,
          visible: true,
          created_at: '',
          updated_at: '',
        } satisfies DashboardStatPreference;
      });

  const initializeStats = useCallback(
    async (metricKeys: string[]) => {
      setError(null);
      try {
        const rows = await apiFetch<DashboardStatPreference[]>('/api/dashboard-stats', {
          method: 'POST',
          body: JSON.stringify({
            dependent_id: dependentId ?? null,
            items: metricKeys.map((key, i) => ({
              widget_type: 'vital',
              metric_key: key,
              position: i,
              pinned: false,
              visible: true,
            })),
          }),
        });
        setStats(rows);
        setHasCustomized(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save dashboard stats');
      }
    },
    [dependentId],
  );

  const addStat = useCallback(
    async (widgetType: DashboardWidgetType, metricKey: string) => {
      setError(null);
      const maxPos = stats.length > 0
        ? Math.max(...stats.map((s) => s.position))
        : -1;

      try {
        const rows = await apiFetch<DashboardStatPreference[]>('/api/dashboard-stats', {
          method: 'POST',
          body: JSON.stringify({
            dependent_id: dependentId ?? null,
            items: [
              {
                widget_type: widgetType,
                metric_key: metricKey,
                position: maxPos + 1,
                visible: true,
                pinned: false,
              },
            ],
          }),
        });
        setStats((prev) => [...prev, ...rows]);
        setHasCustomized(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add stat');
      }
    },
    [dependentId, stats],
  );

  const removeStat = useCallback(async (id: string) => {
    setError(null);
    try {
      await apiFetch<void>(`/api/dashboard-stats/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setStats((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove stat');
    }
  }, []);

  const toggleVisibility = useCallback(
    async (id: string) => {
      const stat = stats.find((s) => s.id === id);
      if (!stat) return;

      const newVisible = !stat.visible;
      try {
        await apiFetch<DashboardStatPreference>(
          `/api/dashboard-stats/${encodeURIComponent(id)}`,
          { method: 'PATCH', body: JSON.stringify({ visible: newVisible }) },
        );
        setStats((prev) =>
          prev.map((s) => (s.id === id ? { ...s, visible: newVisible } : s)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update stat');
      }
    },
    [stats],
  );

  const togglePinned = useCallback(
    async (id: string) => {
      const stat = stats.find((s) => s.id === id);
      if (!stat) return;

      const newPinned = !stat.pinned;
      try {
        await apiFetch<DashboardStatPreference>(
          `/api/dashboard-stats/${encodeURIComponent(id)}`,
          { method: 'PATCH', body: JSON.stringify({ pinned: newPinned }) },
        );
        setStats((prev) =>
          prev.map((s) => (s.id === id ? { ...s, pinned: newPinned } : s)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update stat');
      }
    },
    [stats],
  );

  const reorder = useCallback(
    async (id: string, direction: 'up' | 'down') => {
      const sorted = [...stats].sort((a, b) => a.position - b.position);
      const idx = sorted.findIndex((s) => s.id === id);
      if (idx < 0) return;

      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= sorted.length) return;

      const a = sorted[idx];
      const b = sorted[swapIdx];

      // Swap positions
      const [posA, posB] = [a.position, b.position];

      try {
        await Promise.all([
          apiFetch<DashboardStatPreference>(
            `/api/dashboard-stats/${encodeURIComponent(a.id)}`,
            { method: 'PATCH', body: JSON.stringify({ position: posB }) },
          ),
          apiFetch<DashboardStatPreference>(
            `/api/dashboard-stats/${encodeURIComponent(b.id)}`,
            { method: 'PATCH', body: JSON.stringify({ position: posA }) },
          ),
        ]);
        setStats((prev) =>
          prev.map((s) => {
            if (s.id === a.id) return { ...s, position: posB };
            if (s.id === b.id) return { ...s, position: posA };
            return s;
          }),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reorder stats');
      }
    },
    [stats],
  );

  return {
    stats: effectiveStats,
    loading,
    error,
    hasCustomized,
    defaultKeys,
    availableLabTests,
    initializeStats,
    addStat,
    removeStat,
    toggleVisibility,
    togglePinned,
    reorder,
  };
}
