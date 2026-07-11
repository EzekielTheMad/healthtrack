'use client';

import React, { useMemo, useState } from 'react';
import { useExerciseCatalog } from '@/hooks/useExerciseCatalog';
import { useExerciseHistory } from '@/hooks/useExerciseHistory';
import { buildTrendPoints, weeklyTonnage, type TrendPoint } from '@/lib/fitness/trends';
import {
  parsedSetsFromWire,
  type ExerciseHistoryItemWire,
  type ExerciseWire,
} from '@/lib/fitness/api-types';
import { formatMetricValue } from '@/lib/metrics/format';
import BarChart from '@/components/vitals/BarChart';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import ExerciseTrendChart from './ExerciseTrendChart';

// ---------------------------------------------------------------------------
// Trends tab — exercise picker (catalog grouped by review status) feeding a
// working-weight trend chart (e1RM secondary, PR badges) and weekly tonnage
// bars (reusing the vitals BarChart). All series math lives in the pure
// lib (src/lib/fitness/trends.ts).
// ---------------------------------------------------------------------------

export function exerciseDisplayName(e: Pick<ExerciseWire, 'name' | 'variant'>): string {
  return e.variant ? `${e.name} (${e.variant})` : e.name;
}

export interface ExerciseTrendPanelProps {
  mode: 'weight' | 'time';
  points: TrendPoint[];
  tonnage: { weekStart: string; tonnage: number }[];
}

/** Presentational chart panel (exported for tests). */
export function ExerciseTrendPanel({ mode, points, tonnage }: ExerciseTrendPanelProps) {
  if (points.length === 0) {
    return (
      <p className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
        No parsed sets for this exercise yet — entries logged raw-only chart once their
        sets are structured.
      </p>
    );
  }

  const latest = points[points.length - 1];
  const best = Math.max(...points.map((p) => p.value));
  const prCount = points.filter((p) => p.isPr).length;
  const unit = mode === 'time' ? 'sec' : 'lb';

  return (
    <div className="space-y-6">
      {/* Compact stat strip */}
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {(
          [
            ['Latest', `${formatMetricValue(latest.value, 1)} ${unit}`],
            ['Best', `${formatMetricValue(best, 1)} ${unit}`],
            ['PRs in window', String(prCount)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              {label}
            </span>
            <span
              className="text-lg font-mono font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      <ExerciseTrendChart points={points} mode={mode} />

      {mode === 'weight' && tonnage.length > 0 && (
        <div>
          <p
            className="text-[11px] uppercase tracking-wider mb-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Weekly tonnage (lb, working sets)
          </p>
          <BarChart
            data={tonnage.map((b) => ({
              value: b.tonnage,
              date: b.weekStart,
              label: 'Tonnage',
            }))}
            height={180}
            decimals={0}
          />
        </div>
      )}
    </div>
  );
}

function trendInputs(items: ExerciseHistoryItemWire[]) {
  return items.map((item) => ({
    date: item.session.started_at,
    sets: parsedSetsFromWire(item.sets),
    workingWeight: item.working_weight,
    topSeconds: item.top_seconds,
  }));
}

/** Data-fetching Trends tab. */
export default function TrendsView() {
  const { exercises, loading: catalogLoading, error: catalogError } = useExerciseCatalog();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const confirmed = useMemo(
    () => exercises.filter((e) => e.review_status === 'confirmed'),
    [exercises],
  );
  const unreviewed = useMemo(
    () => exercises.filter((e) => e.review_status === 'unreviewed'),
    [exercises],
  );

  // Default to the first confirmed exercise once the catalog loads.
  const effectiveId = selectedId ?? confirmed[0]?.id ?? unreviewed[0]?.id ?? null;
  const selected = exercises.find((e) => e.id === effectiveId) ?? null;

  const { items, loading: historyLoading, error: historyError } = useExerciseHistory(effectiveId);

  const points = useMemo(
    () => (selected ? buildTrendPoints(trendInputs(items), selected.mode) : []),
    [items, selected],
  );
  const tonnage = useMemo(
    () =>
      weeklyTonnage(trendInputs(items), Intl.DateTimeFormat().resolvedOptions().timeZone),
    [items],
  );

  if (catalogLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (catalogError) {
    return (
      <div
        role="alert"
        className="rounded-lg border px-4 py-3 text-sm"
        style={{
          backgroundColor: 'rgba(224, 122, 95, 0.12)',
          borderColor: 'var(--color-terracotta)',
          color: 'var(--color-terracotta)',
        }}
      >
        {catalogError}
      </div>
    );
  }

  if (exercises.length === 0) {
    return (
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941" />
            </svg>
          }
          title="No exercises yet"
          description="Your exercise catalog builds itself from logged workouts. Log a session and the trends appear here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Exercise picker — grouped by review status */}
      <label className="inline-flex items-center gap-2">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
          Exercise
        </span>
        <select
          value={effectiveId ?? ''}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-lg border px-2.5 py-1.5 text-sm"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-card)',
            color: 'var(--color-text-primary)',
          }}
        >
          {confirmed.length > 0 && (
            <optgroup label="Confirmed">
              {confirmed.map((e) => (
                <option key={e.id} value={e.id}>
                  {exerciseDisplayName(e)}
                </option>
              ))}
            </optgroup>
          )}
          {unreviewed.length > 0 && (
            <optgroup label="Unreviewed">
              {unreviewed.map((e) => (
                <option key={e.id} value={e.id}>
                  {exerciseDisplayName(e)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <div
        className="rounded-xl border p-5"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        {historyError ? (
          <p role="alert" className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
            {historyError}
          </p>
        ) : historyLoading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : selected ? (
          <ExerciseTrendPanel mode={selected.mode} points={points} tonnage={tonnage} />
        ) : null}
      </div>
    </div>
  );
}
