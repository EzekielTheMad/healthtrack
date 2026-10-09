'use client';

import React, { useMemo, useState } from 'react';
import { formatUtcDay, formatUtcDayYear } from '@/lib/dates';
import type { ActiveMetricGoal } from '@/lib/fitness/goal-direction';
import {
  MEASUREMENT_PRESETS,
  buildLatestSession,
  buildMeasurementReport,
  buildMeasurementSeries,
  filterMeasurementRows,
  presetKeys,
  type MeasurementEntry,
  type MeasurementPresetId,
  type MeasurementSlotRow,
} from '@/lib/metrics/measurements';
import { BODY_MEASUREMENT_KEYS, getMetric } from '@/lib/metrics/registry';
import type { ViewVitalRow } from '@/lib/metrics/vitals-view';
import EmptyState from '@/components/shared/EmptyState';
import SourceBadge from '@/components/shared/SourceBadge';
import MeasurementTrendChart from './MeasurementTrendChart';

// ---------------------------------------------------------------------------
// Vitals → Measurements.
//
// Circumferences are sparse point-in-time readings, so this view answers
// "where am I now, what moved since last time, and what has the series done"
// rather than reusing the daily-vitals card wall. All of the arithmetic lives
// in src/lib/metrics/measurements.ts; this file is presentation only.
//
// The range selector filters CLIENT-SIDE over the rows the page already
// fetched, so switching ranges never hides the latest reading behind a
// refetch — and the latest-session card always reads the unfiltered rows.
// ---------------------------------------------------------------------------

const RANGES = [
  { id: '3m', label: '3M', months: 3 },
  { id: '6m', label: '6M', months: 6 },
  { id: '1y', label: '1Y', months: 12 },
  { id: 'all', label: 'All', months: null },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

const cardClass = 'rounded-xl border p-4 sm:p-5';
const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  borderColor: 'var(--border-card)',
};

/** Sage-tint pill convention shared with the vitals view selector. */
function pillStyle(active: boolean): React.CSSProperties {
  return {
    backgroundColor: active ? 'rgba(129, 178, 154, 0.15)' : 'transparent',
    color: active ? 'var(--color-sage)' : 'var(--color-text-muted)',
    border: active ? '1px solid var(--color-sage)' : '1px solid var(--border-card)',
  };
}

const pillClass =
  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer';

/**
 * Change tones. Neutral is the DEFAULT and the only tone a circumference gets
 * without an explicit user goal — a waist moving either way is not good or bad
 * news on its own, so nothing here paints red/green by default.
 */
function toneColor(tone: 'good' | 'warn' | 'bad' | 'neutral'): string {
  switch (tone) {
    case 'good':
      return 'var(--color-sage)';
    case 'bad':
      return 'var(--color-terracotta)';
    case 'warn':
      return 'var(--color-warning)';
    default:
      return 'var(--color-text-muted)';
  }
}

/** `+0.4` / `−0.5` / `no change` at the metric's display precision. */
function ChangeLine({ entry }: { entry: MeasurementEntry }) {
  if (!entry.change) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        Baseline
      </span>
    );
  }
  const { change } = entry;
  const text =
    change.direction === 'flat'
      ? 'No change'
      : `${change.direction === 'up' ? '+' : '−'}${change.display}${entry.unit ? ` ${entry.unit}` : ''}`;

  return (
    <span className="text-[11px]" style={{ color: toneColor(change.tone) }}>
      {text}
      <span style={{ color: 'var(--color-text-muted)' }}>
        {' '}
        since{' '}
        <time dateTime={change.previous.recordedAt.slice(0, 10)}>
          {formatUtcDay(change.previous.recordedAt)}
        </time>
      </span>
    </span>
  );
}

/** One measured value: number, unit, change, and its own date when stale. */
function ValueCell({
  entry,
  side,
}: {
  entry: MeasurementEntry;
  /** Column label for a bilateral pair; omitted for unsided values. */
  side?: 'Left' | 'Right';
}) {
  return (
    <div className="min-w-0">
      {side && (
        <p
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {side}
        </p>
      )}
      <p className="flex items-baseline gap-1">
        <span
          className="text-lg font-mono font-semibold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {entry.display}
        </span>
        {entry.unit && (
          <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {entry.unit}
          </span>
        )}
      </p>
      <ChangeLine entry={entry} />
      {entry.stale && (
        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          measured{' '}
          <time dateTime={entry.latest.recordedAt.slice(0, 10)}>
            {formatUtcDay(entry.latest.recordedAt)}
          </time>
        </p>
      )}
    </div>
  );
}

/** A family row: an unsided value and/or a left/right pair, side by side. */
function SlotRow({ row }: { row: MeasurementSlotRow }) {
  return (
    <div
      className="py-3 border-t first:border-t-0 first:pt-0"
      style={{ borderColor: 'var(--border-card)' }}
    >
      <p
        className="text-xs font-medium mb-1.5"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {row.label}
      </p>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {row.unsided && <ValueCell entry={row.unsided} />}
        {row.left && <ValueCell entry={row.left} side="Left" />}
        {row.right && <ValueCell entry={row.right} side="Right" />}
      </div>
    </div>
  );
}

export interface MeasurementsViewProps {
  /** Every vital row the page loaded — filtered to measurements internally. */
  vitals: ViewVitalRow[];
  /** Active metric goals; without one for a metric, changes stay neutral. */
  metricGoals?: readonly ActiveMetricGoal[];
  /** Opens the page's manual-entry form (the empty-state affordance). */
  onAddManual?: () => void;
  /** Anchors the relative ranges; injected by tests. */
  now?: Date;
}

export default function MeasurementsView({
  vitals,
  metricGoals = [],
  onAddManual,
  now,
}: MeasurementsViewProps) {
  const [rangeId, setRangeId] = useState<RangeId>('1y');
  const [presetId, setPresetId] = useState<MeasurementPresetId>('core');
  const [customKeys, setCustomKeys] = useState<string[] | null>(null);

  // The latest-session card reads the FULL history: a range filter is a lens
  // on the trend, never a reason to hide the most recent reading.
  const allRows = useMemo(() => filterMeasurementRows(vitals), [vitals]);
  const session = useMemo(
    () => buildLatestSession(allRows, metricGoals),
    [allRows, metricGoals],
  );

  const range = RANGES.find((r) => r.id === rangeId)!;
  const rangeRows = useMemo(() => {
    if (range.months === null) return allRows;
    const to = now ?? new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - range.months);
    return filterMeasurementRows(allRows, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }, [allRows, range.months, now]);

  const selectedKeys = customKeys ?? presetKeys(presetId);
  const series = useMemo(
    () => buildMeasurementSeries(rangeRows, selectedKeys),
    [rangeRows, selectedKeys],
  );
  const report = useMemo(() => buildMeasurementReport(rangeRows), [rangeRows]);

  // Only offer metrics that actually have readings — an 18-checkbox wall of
  // mostly-empty options is not a useful control.
  const availableKeys = useMemo(() => {
    const present = new Set(allRows.map((r) => r.metric_key));
    return BODY_MEASUREMENT_KEYS.filter((k) => present.has(k));
  }, [allRows]);

  if (!session) {
    return (
      <div className="rounded-xl border" style={cardStyle}>
        <EmptyState
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 9.75h18M6.75 9.75V13.5M10.5 9.75v2.25M14.25 9.75V13.5M18 9.75v2.25M3 6.75h18v10.5H3z"
              />
            </svg>
          }
          title="No body measurements yet"
          description="Circumference readings from a tape, a scan or any integration that writes them show up here. Add one manually to start a baseline."
          action={onAddManual ? { label: 'Add Vital', onClick: onAddManual } : undefined}
        />
      </div>
    );
  }

  function toggleKey(key: string) {
    setCustomKeys((prev) => {
      const base = prev ?? presetKeys(presetId);
      return base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
    });
  }

  return (
    <div className="space-y-4">
      {/* ---- Latest session ------------------------------------------- */}
      <section className={cardClass} style={cardStyle} aria-labelledby="measurements-latest">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h2
            id="measurements-latest"
            className="text-base font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Latest measurements
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              As of{' '}
              <time dateTime={session.asOf.slice(0, 10)}>
                {formatUtcDayYear(session.asOf)}
              </time>
            </span>
            {session.sources.map((s) => (
              <SourceBadge key={s} source={s} />
            ))}
          </div>
        </div>

        <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-muted)' }}>
          {session.baseline
            ? 'Baseline — your first reading of each measurement. Changes appear once there is a second one.'
            : 'Each value is compared with the previous reading of that same measurement.'}
          {session.mixedDates &&
            ' Some measurements were last taken earlier; those carry their own date.'}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6">
          {session.groups.map((group) => (
            <section key={group.id} className="min-w-0" aria-label={group.label}>
              <h3
                className="text-xs font-semibold uppercase tracking-wide mt-3 mb-1"
                style={{ color: 'var(--color-sage)' }}
              >
                {group.label}
              </h3>
              {group.rows.map((row) => (
                <SlotRow key={row.base} row={row} />
              ))}
            </section>
          ))}
        </div>
      </section>

      {/* ---- Range ----------------------------------------------------- */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3"
        style={cardStyle}
        role="group"
        aria-label="Measurement date range"
      >
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          Range
        </span>
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRangeId(r.id)}
            aria-pressed={rangeId === r.id}
            className={pillClass}
            style={pillStyle(rangeId === r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ---- Trends ---------------------------------------------------- */}
      <section className={cardClass} style={cardStyle} aria-labelledby="measurements-trends">
        <h2
          id="measurements-trends"
          className="text-base font-semibold mb-3"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Trends
        </h2>

        <div
          className="flex flex-wrap items-center gap-2 mb-3"
          role="group"
          aria-label="Measurement chart preset"
        >
          {MEASUREMENT_PRESETS.map((p) => {
            const active = customKeys === null && presetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPresetId(p.id);
                  setCustomKeys(null);
                }}
                aria-pressed={active}
                className={pillClass}
                style={pillStyle(active)}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <fieldset className="mb-3">
          <legend className="text-[11px] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
            Measurements shown
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {availableKeys.map((key) => (
              <label
                key={key}
                className="flex items-center gap-1.5 text-xs cursor-pointer"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <input
                  type="checkbox"
                  checked={selectedKeys.includes(key)}
                  onChange={() => toggleKey(key)}
                  className="accent-[var(--color-sage)] cursor-pointer"
                />
                {getMetric(key)?.label ?? key}
              </label>
            ))}
          </div>
        </fieldset>

        <MeasurementTrendChart series={series} />
      </section>

      {/* ---- Deterministic report -------------------------------------- */}
      <section className={cardClass} style={cardStyle} aria-labelledby="measurements-report">
        <h2
          id="measurements-report"
          className="text-base font-semibold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Report
        </h2>
        <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-muted)' }}>
          First and latest reading over the selected range. Measurements are taken
          occasionally, so a change here spans whatever time separates those two
          readings — it is not a rate, and it is not judged as progress or regression.
        </p>

        {report.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            No measurements in this range. Widen it to see earlier readings.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <caption className="sr-only">
                Body measurements over the selected range: first reading, latest
                reading, change and number of readings.
              </caption>
              <thead>
                <tr style={{ color: 'var(--color-text-muted)' }}>
                  <th scope="col" className="text-left font-medium py-1.5 pr-3">
                    Measurement
                  </th>
                  <th scope="col" className="text-right font-medium py-1.5 px-3">
                    First
                  </th>
                  <th scope="col" className="text-right font-medium py-1.5 px-3">
                    Latest
                  </th>
                  <th scope="col" className="text-right font-medium py-1.5 px-3">
                    Change
                  </th>
                  <th scope="col" className="text-right font-medium py-1.5 pl-3">
                    Readings
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.map((r) => (
                  <tr
                    key={r.key}
                    className="border-t"
                    style={{ borderColor: 'var(--border-card)' }}
                  >
                    <th
                      scope="row"
                      className="text-left font-normal py-1.5 pr-3"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {r.label}
                      {r.unit && (
                        <span style={{ color: 'var(--color-text-muted)' }}> ({r.unit})</span>
                      )}
                    </th>
                    <td
                      className="text-right font-mono py-1.5 px-3"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {r.firstDisplay}
                      <span
                        className="block text-[10px] font-sans"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <time dateTime={r.first.recordedAt.slice(0, 10)}>
                          {formatUtcDay(r.first.recordedAt)}
                        </time>
                      </span>
                    </td>
                    <td
                      className="text-right font-mono py-1.5 px-3"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {r.latestDisplay}
                      <span
                        className="block text-[10px] font-sans"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <time dateTime={r.latest.recordedAt.slice(0, 10)}>
                          {formatUtcDay(r.latest.recordedAt)}
                        </time>
                      </span>
                    </td>
                    <td
                      className="text-right font-mono py-1.5 px-3"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {r.change === null
                        ? 'Baseline'
                        : r.change.direction === 'flat'
                          ? 'No change'
                          : `${r.change.direction === 'up' ? '+' : '−'}${r.change.display}`}
                    </td>
                    <td
                      className="text-right font-mono py-1.5 pl-3"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {r.readings}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
