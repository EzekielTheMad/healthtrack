'use client';

import { useMemo, useCallback, useState } from 'react';
import Link from 'next/link';
import { useVitals } from '@/hooks/useVitals';
import { useMedications } from '@/hooks/useMedications';
import { useLabResults } from '@/hooks/useLabResults';
import { useProfile } from '@/hooks/useProfile';
import { useConditions } from '@/hooks/useConditions';
import { useProviders } from '@/hooks/useProviders';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useLabStatData } from '@/hooks/useLabStatData';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useDateRangeContext } from '@/components/shared/DateRangeContext';
import { getVitalRange } from '@/lib/reference-ranges';
import { getMetricDefinition, buildLabResultDefinition } from '@/lib/dashboard-metrics';
import type { Vital } from '@/lib/types';

import DateRangeFilter from '@/components/shared/DateRangeFilter';
import SourceBadge from '@/components/shared/SourceBadge';
import RangeIndicator from '@/components/shared/RangeIndicator';
import EmptyState from '@/components/shared/EmptyState';
import Skeleton from '@/components/shared/Skeleton';
import FlagBadge from '@/components/shared/FlagBadge';
import TrendLine from '@/components/labs/TrendLine';
import GettingStartedChecklist from '@/components/dashboard/GettingStartedChecklist';
import DashboardCustomizer from '@/components/dashboard/DashboardCustomizer';
import HealthSummaryCard from '@/components/dashboard/HealthSummaryCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function getLatestVitalData(vitals: Vital[], metricKey: string) {
  const filtered = vitals
    .filter((v) => v.metric_key === metricKey)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());

  const latest = filtered[0] ?? null;
  const sparklineData = filtered.slice(0, 7).map((v) => ({
    value: v.value,
    date: v.recorded_at,
  }));

  return { latest, sparklineData };
}

const FREQ_LABELS: Record<string, string> = {
  once_daily: 'Once daily',
  twice_daily: 'Twice daily',
  three_times_daily: '3x daily',
  four_times_daily: '4x daily',
  every_other_day: 'Every other day',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  as_needed: 'As needed',
  other: 'Other',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <div
      className="rounded-xl border p-5 space-y-3"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <Skeleton variant="text" className="w-24 h-3" />
      <Skeleton variant="text" className="w-16 h-7" />
      <Skeleton variant="rect" className="w-full h-10" />
      <Skeleton variant="text" className="w-full h-6" />
    </div>
  );
}

function MedRowSkeleton() {
  return (
    <div className="flex items-center justify-between py-3 px-4">
      <div className="space-y-1.5 flex-1">
        <Skeleton variant="text" className="w-32 h-4" />
        <Skeleton variant="text" className="w-48 h-3" />
      </div>
    </div>
  );
}

function LabFlagRowSkeleton() {
  return (
    <div className="flex items-center justify-between py-3 px-4">
      <Skeleton variant="text" className="w-40 h-4" />
      <Skeleton variant="text" className="w-16 h-5" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { capabilities } = useCapabilities();
  const { dateRange, setDateRange } = useDateRangeContext();
  const { vitals, loading: vitalsLoading, error: vitalsError } = useVitals({
    startDate: dateRange.start ?? undefined,
    endDate: dateRange.end ?? undefined,
  });
  const { medications, loading: medsLoading, error: medsError } = useMedications({ activeOnly: true });
  const { labVisits, loading: labsLoading, error: labsError } = useLabResults();
  const { profile, loading: profileLoading } = useProfile();
  const { conditions, loading: conditionsLoading } = useConditions();
  const { providers, loading: providersLoading } = useProviders();

  // Dashboard stat preferences
  const {
    stats: dashboardStats,
    loading: statsLoading,
    hasCustomized,
    availableLabTests,
    addStat,
    removeStat,
    toggleVisibility,
    togglePinned,
    reorder,
  } = useDashboardStats();

  const [customizerOpen, setCustomizerOpen] = useState(false);

  // Visible stats sorted by position, pinned first
  const visibleStats = useMemo(() => {
    return [...dashboardStats]
      .filter((s) => s.visible)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.position - b.position;
      });
  }, [dashboardStats]);

  // Collect lab test names from visible lab_result stats for the useLabStatData hook
  const labTestNames = useMemo(
    () => visibleStats.filter((s) => s.widget_type === 'lab_result').map((s) => s.metric_key),
    [visibleStats],
  );
  const { labStatData } = useLabStatData(labTestNames);

  // Bridge DateRangeFilter (Date objects) <-> context (ISO strings)
  const dateFilterValue = useMemo(() => {
    const from = dateRange.start ? new Date(dateRange.start) : (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d; })();
    const to = dateRange.end ? new Date(dateRange.end) : new Date();
    return { from, to };
  }, [dateRange]);

  const handleDateFilterChange = useCallback(
    (range: { from: Date; to: Date }) => {
      setDateRange({
        start: range.from.toISOString(),
        end: range.to.toISOString(),
      });
    },
    [setDateRange],
  );

  // User age & sex for reference ranges
  const userAge = useMemo(() => {
    if (!profile?.date_of_birth) return 30; // sensible default
    return calculateAge(profile.date_of_birth);
  }, [profile]);

  const userSex = profile?.biological_sex ?? 'male';

  // Most recent lab visit with flagged results
  const flaggedResults = useMemo(() => {
    if (!labVisits.length) return [];
    const latest = labVisits[0];
    return latest.lab_results.filter(
      (r) => r.flag === 'high' || r.flag === 'low' || r.flag === 'critical',
    );
  }, [labVisits]);

  const isLoading = vitalsLoading || profileLoading || statsLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Dashboard
        </h1>
        {capabilities?.ai !== false && (
        <Link
          href="/query"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors no-underline"
          style={{ backgroundColor: 'var(--color-sage)', color: 'var(--color-bark)' }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Quick Query
        </Link>
        )}
      </div>

      {/* Getting Started Checklist for new users */}
      <GettingStartedChecklist
        profile={profile}
        medicationCount={medications.length}
        conditionCount={conditions.length}
        vitalCount={vitals.length}
        labVisitCount={labVisits.length}
        providerCount={providers.length}
        loading={profileLoading || medsLoading || conditionsLoading || vitalsLoading || labsLoading || providersLoading}
      />

      {/* AI Health Overview */}
      <HealthSummaryCard />

      {/* Sticky DateRangeFilter */}
      <DateRangeFilter value={dateFilterValue} onChange={handleDateFilterChange} />

      {/* Error banner */}
      {(vitalsError || medsError || labsError) && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{ backgroundColor: 'rgba(224, 122, 95, 0.15)', color: 'var(--color-terracotta)' }}
        >
          {vitalsError || medsError || labsError}
        </div>
      )}

      {/* Quick Stat Cards — dynamic based on user preferences */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Quick Stats
          </h2>
          <button
            type="button"
            onClick={() => setCustomizerOpen(!customizerOpen)}
            className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer"
            style={{ color: 'var(--color-sage)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Customize
          </button>
        </div>

        {/* Inline customizer panel */}
        {customizerOpen && (
          <div className="mb-4">
            <DashboardCustomizer
              stats={dashboardStats}
              availableLabTests={availableLabTests}
              onAddStat={addStat}
              onRemoveStat={removeStat}
              onToggleVisibility={toggleVisibility}
              onTogglePinned={togglePinned}
              onReorder={reorder}
              onClose={() => setCustomizerOpen(false)}
            />
          </div>
        )}

        {/* Stat cards grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
            : visibleStats.map((stat) => {
                if (stat.widget_type === 'vital') {
                  // Vital stat card
                  const def = getMetricDefinition(stat.metric_key);
                  if (!def) return null;

                  const { latest, sparklineData } = getLatestVitalData(vitals, stat.metric_key);
                  const range = getVitalRange(stat.metric_key, userAge, userSex);
                  const hasData = latest !== null;
                  const displayValue = hasData
                    ? (def.formatValue(latest.value))
                    : '\u2014';

                  return (
                    <div
                      key={stat.id}
                      className="rounded-xl border p-5 flex flex-col gap-3"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: stat.pinned ? 'var(--color-terracotta)' : 'var(--border-card)',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                          {stat.pinned && <span style={{ color: 'var(--color-terracotta)', fontSize: '10px' }}>★</span>}
                          {def.label}
                        </span>
                        {hasData && <SourceBadge source={latest.source} />}
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold font-mono" style={{ color: 'var(--color-text-primary)' }}>
                          {displayValue}
                        </span>
                        {hasData && (
                          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {def.displayUnit}
                          </span>
                        )}
                      </div>
                      {sparklineData.length > 1 ? (
                        <TrendLine data={sparklineData} refLow={range?.low} refHigh={range?.high} width={160} height={40} />
                      ) : (
                        <div className="flex items-center justify-center h-10 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {hasData ? 'Not enough data for trend' : 'No data'}
                        </div>
                      )}
                      {hasData && range ? (
                        <RangeIndicator value={latest.value} low={range.low} high={range.high} unit={range.unit} label={range.label} />
                      ) : hasData ? (
                        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Set up your profile for reference ranges</p>
                      ) : null}
                    </div>
                  );
                }

                // Lab result stat card
                const labData = labStatData.find((d) => d.testName === stat.metric_key);
                const labDef = buildLabResultDefinition(stat.metric_key, labData?.unit ?? null);
                const hasLabData = labData != null;
                const labDisplayValue = hasLabData ? labDef.formatValue(labData.latestValue) : '\u2014';

                return (
                  <div
                    key={stat.id}
                    className="rounded-xl border p-5 flex flex-col gap-3"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: stat.pinned ? 'var(--color-terracotta)' : 'var(--border-card)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium flex items-center gap-1 truncate" style={{ color: 'var(--color-text-muted)' }}>
                        {stat.pinned && <span style={{ color: 'var(--color-terracotta)', fontSize: '10px' }}>★</span>}
                        {labDef.label}
                      </span>
                      {hasLabData && labData.flag && (
                        <FlagBadge flag={labData.flag} />
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold font-mono" style={{ color: 'var(--color-text-primary)' }}>
                        {labDisplayValue}
                      </span>
                      {hasLabData && labDef.displayUnit && (
                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          {labDef.displayUnit}
                        </span>
                      )}
                    </div>
                    {hasLabData && labData.sparklineData.length > 1 ? (
                      <TrendLine
                        data={labData.sparklineData}
                        refLow={labData.refLow ?? undefined}
                        refHigh={labData.refHigh ?? undefined}
                        width={160}
                        height={40}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-10 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {hasLabData ? 'Not enough data for trend' : 'No data'}
                      </div>
                    )}
                    {hasLabData && labData.refLow != null && labData.refHigh != null ? (
                      <RangeIndicator
                        value={labData.latestValue}
                        low={labData.refLow}
                        high={labData.refHigh}
                        unit={labDef.displayUnit}
                        label=""
                      />
                    ) : hasLabData ? (
                      <p className="text-[11px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                        ref: not available
                      </p>
                    ) : null}
                  </div>
                );
              })}
        </div>

        {/* Empty state when no stats are configured */}
        {!isLoading && visibleStats.length === 0 && !hasCustomized && (
          <div
            className="mt-4 rounded-xl border"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
          >
            <EmptyState
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
                </svg>
              }
              title="No vitals recorded yet"
              description="Connect a device or manually log vitals to see your health trends here."
            />
          </div>
        )}

        {!isLoading && visibleStats.length === 0 && hasCustomized && (
          <div
            className="mt-4 rounded-xl border p-6 text-center"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
          >
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              All stats are hidden.{' '}
              <button
                type="button"
                onClick={() => setCustomizerOpen(true)}
                className="font-medium cursor-pointer"
                style={{ color: 'var(--color-sage)' }}
              >
                Customize
              </button>{' '}
              to show stats on your dashboard.
            </p>
          </div>
        )}
      </section>

      {/* Bottom grid: Active Meds + Lab Flags side by side on lg */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Medications */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Active Medications
            </h2>
            <Link
              href="/medications"
              className="text-xs font-medium no-underline"
              style={{ color: 'var(--color-sage)' }}
            >
              View all
            </Link>
          </div>
          <div
            className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
          >
            {medsLoading ? (
              <div className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <MedRowSkeleton key={i} />
                ))}
              </div>
            ) : medications.length === 0 ? (
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
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                }
                title="No active medications"
                description="Medications you add will appear here for quick reference."
              />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
                {medications.slice(0, 5).map((med) => (
                  <li key={med.id}>
                    <Link
                      href="/medications"
                      className="flex items-center justify-between py-3 px-4 transition-colors no-underline hover:opacity-80"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {med.name}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                          {[med.dosage, med.frequency ? (FREQ_LABELS[med.frequency] ?? med.frequency) : null]
                            .filter(Boolean)
                            .join(' · ') || 'No details'}
                        </p>
                      </div>
                      {med.category && (
                        <span
                          className="ml-3 shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium"
                          style={{ color: 'var(--accent-purple)', backgroundColor: 'rgba(167, 139, 250, 0.12)' }}
                        >
                          {med.category}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
                {medications.length > 5 && (
                  <li>
                    <Link
                      href="/medications"
                      className="block text-center py-3 text-xs font-medium no-underline"
                      style={{ color: 'var(--color-sage)' }}
                    >
                      +{medications.length - 5} more medications
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>

        {/* Recent Lab Flags */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Recent Lab Flags
            </h2>
            <Link
              href="/labs"
              className="text-xs font-medium no-underline"
              style={{ color: 'var(--color-sage)' }}
            >
              View all
            </Link>
          </div>
          <div
            className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
          >
            {labsLoading ? (
              <div className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <LabFlagRowSkeleton key={i} />
                ))}
              </div>
            ) : flaggedResults.length === 0 ? (
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
                      d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5"
                    />
                  </svg>
                }
                title="No lab flags"
                description="Flagged lab results will appear here when you upload lab reports."
              />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
                {flaggedResults.map((result) => (
                  <li key={result.id}>
                    <Link
                      href="/labs"
                      className="flex items-center justify-between py-3 px-4 transition-colors no-underline hover:opacity-80"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {result.test_name}
                        </p>
                        <p className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
                          {result.value} {result.unit ?? ''}
                          {result.reference_range_low != null && result.reference_range_high != null && (
                            <span className="ml-2">
                              (ref: {result.reference_range_low}&ndash;{result.reference_range_high})
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="ml-3 shrink-0">
                        {result.flag && (
                          <FlagBadge flag={result.flag} />
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
