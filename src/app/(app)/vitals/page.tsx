'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { useVitals } from '@/hooks/useVitals';
import { useProfile } from '@/hooks/useProfile';
import { useDateRangeContext } from '@/components/shared/DateRangeContext';
import type { Vital } from '@/lib/types';
import ManualVitalEntry from '@/components/vitals/ManualVitalEntry';
import TrendsView from '@/components/vitals/TrendsView';
import DailyVitalsView from '@/components/vitals/DailyVitalsView';
import FocusView from '@/components/vitals/FocusView';
import { defaultDayKey } from '@/lib/metrics/vitals-view';
import { localDayKey } from '@/lib/dates';
import SourceBadge from '@/components/shared/SourceBadge';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import Skeleton from '@/components/shared/Skeleton';
import DateRangeFilter from '@/components/shared/DateRangeFilter';

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
  const [view, setView] = useState<'focus' | 'daily' | 'trends'>('focus');

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

  // Extract unique connected sources
  const connectedSources = useMemo(() => {
    const set = new Set<string>();
    for (const v of vitals) {
      set.add(v.source);
    }
    return Array.from(set).sort();
  }, [vitals]);

  const hasAnyData = vitals.length > 0;

  // Daily view starts on the most recent day with data in the loaded range
  // (falling back to today). Captured per range load; DailyVitalsView owns
  // navigation from there.
  const initialDay = useMemo(
    () => defaultDayKey(vitals) ?? localDayKey(),
    [vitals],
  );

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

      {/* View toggle: Focus (default) | Daily | All metrics */}
      <div
        className="inline-flex items-center gap-1 rounded-lg border p-1"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        role="tablist"
        aria-label="Vitals view"
      >
        {(['focus', 'daily', 'trends'] as const).map((v) => {
          const active = view === v;
          return (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(v)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: active ? 'rgba(74,222,128,0.15)' : 'transparent',
                color: active ? 'var(--color-sage)' : 'var(--color-text-muted)',
              }}
            >
              {v === 'focus' ? 'Focus' : v === 'daily' ? 'Daily' : 'All metrics'}
            </button>
          );
        })}
      </div>

      {/* Date Range Filter — All metrics only; Focus uses a fixed 90d window
          and the daily view has its own day picker */}
      {view === 'trends' && (
        <DateRangeFilter value={filterValue} onChange={handleFilterChange} />
      )}

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
      ) : view === 'focus' ? (
        <FocusView
          userAge={userAge}
          userSex={userSex}
          onAddManual={() => setShowForm(true)}
        />
      ) : view === 'daily' ? (
        <DailyVitalsView initialDay={initialDay} />
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
        <TrendsView
          vitals={vitals}
          userAge={userAge}
          userSex={userSex}
          rangeFrom={filterValue.from}
          rangeTo={filterValue.to}
        />
      )}
    </div>
  );
}
