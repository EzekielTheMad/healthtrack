'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { useVitals } from '@/hooks/useVitals';
import { useProfile } from '@/hooks/useProfile';
import { useDateRangeContext } from '@/components/shared/DateRangeContext';
import { getVitalRange } from '@/lib/reference-ranges';
import type { Vital } from '@/lib/types';
import ManualVitalEntry from '@/components/vitals/ManualVitalEntry';
import CompactStatCard from '@/components/vitals/CompactStatCard';
import BarChart from '@/components/vitals/BarChart';
import VitalTrendChart from '@/components/vitals/VitalTrendChart';
import SourceBadge from '@/components/shared/SourceBadge';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import Skeleton from '@/components/shared/Skeleton';
import DateRangeFilter from '@/components/shared/DateRangeFilter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METRIC_LABELS: Record<string, string> = {
  resting_hr: 'Resting HR',
  hrv_rmssd: 'HRV',
  spo2: 'SpO2',
  bp_systolic: 'BP Systolic',
  bp_diastolic: 'BP Diastolic',
  weight: 'Weight',
  sleep_duration: 'Sleep Duration',
  steps: 'Steps',
  ahi: 'AHI',
  sleep_score: 'Sleep Score',
};

const BAR_CHART_METRICS = new Set([
  'sleep_score',
  'sleep_duration',
  'steps',
  'ahi',
]);

const COMPACT_STAT_METRICS = new Set([
  'resting_hr',
  'hrv_rmssd',
  'spo2',
  'bp_systolic',
  'bp_diastolic',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateAge(dob: string | null): number {
  if (!dob) return 30; // fallback
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/** Bridge between DateRangeContext (ISO strings) and DateRangeFilter ({from, to} Dates). */
function isoToDate(iso: string | null): Date {
  if (!iso) return new Date(2000, 0, 1);
  return new Date(iso);
}

function dateToIso(d: Date): string {
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function VitalsPage() {
  const { dateRange, setDateRange } = useDateRangeContext();
  const { vitals, loading, error, addVital } = useVitals({
    startDate: dateRange.start ?? undefined,
    endDate: dateRange.end ?? undefined,
  });
  const { profile, loading: profileLoading } = useProfile();
  const [showForm, setShowForm] = useState(false);

  // Bridge for DateRangeFilter
  const filterValue = useMemo(
    () => ({
      from: isoToDate(dateRange.start),
      to: dateRange.end ? new Date(dateRange.end) : new Date(),
    }),
    [dateRange],
  );

  const handleFilterChange = useCallback(
    (range: { from: Date; to: Date }) => {
      setDateRange({
        start: dateToIso(range.from),
        end: dateToIso(range.to),
      });
    },
    [setDateRange],
  );

  // User demographics for range lookup
  const userAge = calculateAge(profile?.date_of_birth ?? null);
  const userSex = profile?.biological_sex ?? 'male';

  // Group vitals by metric_key
  const grouped = useMemo(() => {
    const map = new Map<string, Vital[]>();
    for (const v of vitals) {
      const arr = map.get(v.metric_key);
      if (arr) arr.push(v);
      else map.set(v.metric_key, [v]);
    }
    return map;
  }, [vitals]);

  // Extract unique connected sources
  const connectedSources = useMemo(() => {
    const set = new Set<string>();
    for (const v of vitals) {
      set.add(v.source);
    }
    return Array.from(set).sort();
  }, [vitals]);

  // Bar chart metrics present in data
  const barChartEntries = useMemo(() => {
    const entries: Array<{ key: string; data: Vital[] }> = [];
    for (const key of BAR_CHART_METRICS) {
      const data = grouped.get(key);
      if (data && data.length > 0) {
        entries.push({ key, data });
      }
    }
    return entries;
  }, [grouped]);

  // Compact stat metrics present in data
  const compactStatEntries = useMemo(() => {
    const entries: Array<{
      key: string;
      latest: Vital;
      sparkline: Array<{ value: number; date: string }>;
    }> = [];
    for (const key of COMPACT_STAT_METRICS) {
      const data = grouped.get(key);
      if (data && data.length > 0) {
        // data is ordered desc, latest is first
        const latest = data[0];
        // Last 7 data points for sparkline
        const sparkline = data
          .slice(0, 7)
          .map((v) => ({ value: v.value, date: v.recorded_at }))
          .reverse();
        entries.push({ key, latest, sparkline });
      }
    }
    return entries;
  }, [grouped]);

  // Any metrics that are neither bar chart nor compact stat (e.g., weight)
  const otherEntries = useMemo(() => {
    const entries: Array<{ key: string; latest: Vital }> = [];
    for (const [key, data] of grouped) {
      if (!BAR_CHART_METRICS.has(key) && !COMPACT_STAT_METRICS.has(key) && data.length > 0) {
        entries.push({ key, latest: data[0] });
      }
    }
    return entries;
  }, [grouped]);

  // Trend chart entries: all metrics with >1 data point
  const trendChartEntries = useMemo(() => {
    const entries: Array<{
      key: string;
      data: Array<{ value: number; recorded_at: string }>;
      unit: string;
    }> = [];
    for (const [key, data] of grouped) {
      if (data.length > 1) {
        entries.push({
          key,
          data: data.map((v) => ({ value: v.value, recorded_at: v.recorded_at })),
          unit: data[0]?.unit ?? '',
        });
      }
    }
    return entries;
  }, [grouped]);

  const hasAnyData =
    barChartEntries.length > 0 ||
    compactStatEntries.length > 0 ||
    otherEntries.length > 0;

  async function handleAddVital(
    vital: Omit<Vital, 'id' | 'user_id' | 'created_at'>,
  ) {
    await addVital(vital);
    setShowForm(false);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Vitals &amp; Wearables
        </h1>
        <button
          type="button"
          onClick={() => setShowForm((prev) => !prev)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          style={{
            backgroundColor: showForm ? 'var(--border-card)' : 'var(--color-sage)',
            color: showForm ? 'var(--color-text-primary)' : 'var(--bg-primary)',
          }}
        >
          {showForm ? 'Cancel' : 'Add Vital'}
        </button>
      </div>

      {/* Date Range Filter */}
      <DateRangeFilter value={filterValue} onChange={handleFilterChange} />

      {/* Connected Sources Bar */}
      <div
        className="rounded-xl border p-4 flex items-center gap-3 flex-wrap"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
          Connected Sources:
        </span>
        {connectedSources.length === 0 ? (
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            None connected
          </span>
        ) : (
          connectedSources.map((src) => (
            <SourceBadge key={src} source={src} />
          ))
        )}
      </div>

      {/* Manual entry form */}
      {showForm && <ManualVitalEntry onSubmit={handleAddVital} />}

      {/* Error */}
      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(224, 122, 95, 0.12)',
            borderColor: 'var(--color-terracotta)',
            color: 'var(--color-terracotta)',
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading || profileLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Skeleton variant="card" />
            <Skeleton variant="card" />
            <Skeleton variant="card" />
          </div>
          <div className="flex justify-center py-8">
            <LoadingSpinner size="lg" />
          </div>
        </div>
      ) : !hasAnyData ? (
        /* Empty state */
        <div
          className="rounded-xl border"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <EmptyState
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-10 w-10"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                />
              </svg>
            }
            title="No vitals data yet"
            description="Connect a wearable or enter data manually to start tracking your vitals."
            action={{
              label: 'Add Vital',
              onClick: () => setShowForm(true),
            }}
          />
        </div>
      ) : (
        <>
          {/* Bar Chart Section */}
          {barChartEntries.length > 0 && (
            <section>
              <h2
                className="text-lg font-semibold mb-3"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Trends
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {barChartEntries.map(({ key, data }) => {
                  const range = getVitalRange(key, userAge, userSex);
                  const chartData = data
                    .map((v) => ({
                      value: v.value,
                      date: v.recorded_at,
                      label: METRIC_LABELS[key],
                    }));

                  // Find primary source for this metric
                  const primarySource = data[0]?.source ?? '';

                  return (
                    <div
                      key={key}
                      className="rounded-xl border p-4"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-card)',
                      }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span
                          className="text-sm font-medium"
                          style={{ color: 'var(--color-text-primary)' }}
                        >
                          {METRIC_LABELS[key] ?? key}
                        </span>
                        <SourceBadge source={primarySource} />
                      </div>
                      <BarChart
                        data={chartData}
                        height={200}
                        refLow={range?.low}
                        refHigh={range?.high}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Compact Stat Cards Section */}
          {compactStatEntries.length > 0 && (
            <section>
              <h2
                className="text-lg font-semibold mb-3"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Current Readings
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {compactStatEntries.map(({ key, latest, sparkline }) => {
                  const range = getVitalRange(key, userAge, userSex);

                  return (
                    <CompactStatCard
                      key={key}
                      label={METRIC_LABELS[key] ?? key}
                      value={latest.value}
                      unit={latest.unit ?? ''}
                      source={latest.source}
                      timestamp={latest.recorded_at}
                      sparklineData={sparkline}
                      rangeInfo={
                        range
                          ? { low: range.low, high: range.high }
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </section>
          )}

          {/* Other metrics as compact stat cards (no range/sparkline) */}
          {otherEntries.length > 0 && (
            <section>
              <h2
                className="text-lg font-semibold mb-3"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Other Metrics
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {otherEntries.map(({ key, latest }) => (
                  <CompactStatCard
                    key={key}
                    label={METRIC_LABELS[key] ?? key}
                    value={latest.value}
                    unit={latest.unit ?? ''}
                    source={latest.source}
                    timestamp={latest.recorded_at}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Trend Charts — one per metric with >1 data point */}
          {trendChartEntries.length > 0 && (
            <section>
              <h2
                className="text-lg font-semibold mb-3"
                style={{ color: 'var(--color-text-primary)' }}
              >
                Trend Charts
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {trendChartEntries.map(({ key, data, unit }) => {
                  const range = getVitalRange(key, userAge, userSex);
                  return (
                    <div
                      key={key}
                      className="rounded-xl border p-4"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-card)',
                      }}
                    >
                      <VitalTrendChart
                        data={data}
                        metricKey={key}
                        label={METRIC_LABELS[key] ?? key}
                        refLow={range?.low}
                        refHigh={range?.high}
                        unit={unit}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
