'use client';

import { useEffect, useState } from 'react';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch } from '@/lib/api/client';
import type {
  ComparisonDays,
  ComparisonMetric,
  ComparisonResponse,
  ComparisonSource,
} from '@/lib/metrics/comparison-types';
import { formatUtcDayYear } from '@/lib/dates';
import MetricComparisonChart from './MetricComparisonChart';
import {
  COMPARISON_PRESETS,
  comparisonPoints,
  comparisonSource,
  comparisonValue,
  defaultComparison,
  hasComparisonData,
  type ComparisonChoice,
} from './comparison-view';

const REQUEST_TIMEOUT_MS = 15_000;
const EMPTY_CHOICE: ComparisonChoice = { metric: '', source: null };
const DOMAIN_LABELS = { vitals: 'Vitals', nutrition: 'Nutrition', fitness: 'Fitness' } as const;
const controlStyle = {
  backgroundColor: 'var(--bg-primary)',
  borderColor: 'var(--border-card)',
  color: 'var(--color-text-primary)',
};

function MetricControl({
  side,
  metrics,
  metric,
  source,
  choice,
  onChange,
}: {
  side: 'Left' | 'Right';
  metrics: ComparisonMetric[];
  metric: ComparisonMetric | undefined;
  source: ComparisonSource | undefined;
  choice: ComparisonChoice;
  onChange: (choice: ComparisonChoice) => void;
}) {
  const prefix = side.toLowerCase();
  return (
    <fieldset
      className="min-w-0 space-y-3 rounded-lg border p-3"
      style={{ borderColor: 'var(--border-card)' }}
    >
      <legend className="px-1 text-sm font-medium">{side} axis</legend>
      <div>
        <label htmlFor={`${prefix}-metric`} className="mb-1 block text-xs">
          {side} metric
        </label>
        <select
          id={`${prefix}-metric`}
          className="w-full min-w-0 min-h-11 rounded-lg border px-2 text-sm"
          style={controlStyle}
          value={metric?.key ?? ''}
          onChange={(event) => onChange({ metric: event.target.value, source: null })}
        >
          {Object.entries(DOMAIN_LABELS).map(([domain, label]) => (
            <optgroup label={label} key={domain}>
              {metrics
                .filter((candidate) => candidate.domain === domain)
                .map((candidate) => (
                  <option value={candidate.key} key={candidate.key}>
                    {candidate.label}
                    {candidate.unit ? ` (${candidate.unit})` : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefix}-source`} className="mb-1 block text-xs">
          {side} source
        </label>
        <select
          id={`${prefix}-source`}
          className="w-full min-w-0 min-h-11 rounded-lg border px-2 text-sm"
          style={controlStyle}
          value={source?.source ?? ''}
          onChange={(event) =>
            onChange({ metric: metric?.key ?? '', source: event.target.value || null })
          }
          aria-describedby={`${prefix}-source-note`}
        >
          {!source && <option value="">Choose a source</option>}
          {metric?.sources.map((candidate) => (
            <option value={candidate.source} key={candidate.source}>
              {candidate.label} · {candidate.recorded_days} recorded days
            </option>
          ))}
        </select>
        <p
          id={`${prefix}-source-note`}
          className="mt-1 text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {!source
            ? 'Select a source to show this metric. Competing sources are kept separate.'
            : choice.metric === metric?.key && choice.source !== null
              ? 'Source selected for this comparison only.'
              : 'Using your saved or default source. Changes here apply to this comparison only.'}
        </p>
      </div>
    </fieldset>
  );
}

function Coverage({
  metric,
  source,
  days,
}: {
  metric: ComparisonMetric;
  source: ComparisonSource | undefined;
  days: ComparisonDays;
}) {
  const operation = {
    latest: 'Latest reading per day',
    mean: 'Daily mean of recorded readings',
    sum: 'Daily recorded total',
  }[metric.aggregation];
  return (
    <div className="min-w-0 text-sm">
      <p className="font-medium break-words">
        {metric.label}
        {metric.unit ? ` (${metric.unit})` : ''}
      </p>
      <p style={{ color: 'var(--color-text-muted)' }}>
        {source
          ? `${source.recorded_days} of ${days} days recorded · ${source.label}`
          : 'Choose a source to see coverage'}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
        {operation}
      </p>
    </div>
  );
}

/** The keyed child is replaced synchronously when the viewer or selected person changes. */
export default function ComparisonView({ refreshRevision = 0 }: { refreshRevision?: number }) {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const { user } = useAuth();
  const scope = JSON.stringify([user?.id ?? null, dependentId, delegateOwnerId]);
  return (
    <ScopedComparison
      key={scope}
      dependentId={dependentId}
      delegateOwnerId={delegateOwnerId}
      refreshRevision={refreshRevision}
    />
  );
}

function ScopedComparison({
  dependentId,
  delegateOwnerId,
  refreshRevision,
}: {
  dependentId: string | null;
  delegateOwnerId: string | null;
  refreshRevision: number;
}) {
  const [days, setDays] = useState<ComparisonDays>(30);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    data: ComparisonResponse | null;
    error: string | null;
  } | null>(null);
  const [leftChoice, setLeftChoice] = useState<ComparisonChoice>(EMPTY_CHOICE);
  const [rightChoice, setRightChoice] = useState<ComparisonChoice>(EMPTY_CHOICE);
  const requestKey = JSON.stringify([days, retry, refreshRevision]);

  useEffect(() => {
    const refresh = () => setRetry((value) => value + 1);
    window.addEventListener('vital-source-preferences-changed', refresh);
    return () => window.removeEventListener('vital-source-preferences-changed', refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
      if (!cancelled)
        setLoaded({
          key: requestKey,
          data: null,
          error: 'Comparison request timed out. Please try again.',
        });
    }, REQUEST_TIMEOUT_MS);
    const params = new URLSearchParams({ days: String(days) });
    if (delegateOwnerId) params.set('owner_id', delegateOwnerId);
    else if (dependentId) params.set('dependent_id', dependentId);
    apiFetch<ComparisonResponse>(`/api/metric-comparison?${params}`, { signal: controller.signal })
      .then((data) => {
        if (!cancelled && !timedOut) setLoaded({ key: requestKey, data, error: null });
      })
      .catch(() => {
        if (!cancelled && !timedOut)
          setLoaded({
            key: requestKey,
            data: null,
            error: 'Could not load the comparison. Please try again.',
          });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [days, dependentId, delegateOwnerId, requestKey]);

  const current = loaded?.key === requestKey ? loaded : null;
  const data = current?.data;
  const [defaultLeft, defaultRight] = defaultComparison(data?.metrics ?? []);
  const selectedMetric = (choice: ComparisonChoice, fallback: string) =>
    data?.metrics.find((metric) => metric.key === choice.metric) ??
    data?.metrics.find((metric) => metric.key === fallback);
  const left = selectedMetric(leftChoice, defaultLeft);
  const right = selectedMetric(rightChoice, defaultRight);
  const leftSource = comparisonSource(
    left,
    leftChoice.metric === left?.key ? leftChoice.source : null
  );
  const rightSource = comparisonSource(
    right,
    rightChoice.metric === right?.key ? rightChoice.source : null
  );
  const points = data ? comparisonPoints(data, leftSource, rightSource) : [];
  const hasAny = data?.metrics.some(hasComparisonData) ?? false;

  return (
    <section
      className="min-w-0 rounded-xl border p-4 sm:p-5 space-y-5"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: 'var(--border-card)',
        color: 'var(--color-text-primary)',
      }}
      aria-labelledby="comparison-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="comparison-heading" className="text-lg font-semibold">
            Compare metrics
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Two metrics on the same calendar. Each axis has its own scale.
          </p>
        </div>
        <fieldset
          className="inline-flex rounded-lg border p-1"
          style={{ borderColor: 'var(--border-card)' }}
        >
          <legend className="sr-only">Comparison window</legend>
          {([30, 90] as const).map((option) => (
            <button
              type="button"
              key={option}
              aria-pressed={days === option}
              onClick={() => {
                if (days !== option) {
                  setLoaded(null);
                  setDays(option);
                }
              }}
              className="min-h-11 px-3 rounded-md text-sm cursor-pointer"
              style={{
                color: days === option ? 'var(--color-sage)' : 'var(--color-text-muted)',
                backgroundColor: days === option ? 'rgba(129, 178, 154, 0.12)' : 'transparent',
              }}
            >
              {option} days
            </button>
          ))}
        </fieldset>
      </div>

      {!current ? (
        <p role="status" className="py-8 text-sm">
          Loading comparison…
        </p>
      ) : current.error ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>{current.error}</p>
          <button
            type="button"
            className="min-h-11 rounded-lg border px-4 cursor-pointer"
            style={controlStyle}
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : data ? (
        <>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {formatUtcDayYear(data.start_date)} – {formatUtcDayYear(data.end_date)} ·{' '}
            {data.time_zone}
          </p>
          {data.unavailable_domains.length > 0 && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Unavailable for this person:{' '}
              {data.unavailable_domains.map((domain) => DOMAIN_LABELS[domain]).join(', ')}.
            </p>
          )}
          {data.warnings.map((warning) => (
            <p className="text-sm" key={warning} style={{ color: 'var(--color-warning)' }}>
              {warning}
            </p>
          ))}
          {!hasAny || !left || !right ? (
            <p className="text-sm py-6">
              No recorded comparison data in this window. Try 90 days or add data from your devices.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" aria-label="Comparison presets">
                {COMPARISON_PRESETS.filter((preset) =>
                  [preset.left, preset.right].every((key) =>
                    data.metrics.some((metric) => metric.key === key && hasComparisonData(metric))
                  )
                ).map((preset) => (
                  <button
                    type="button"
                    key={preset.label}
                    className="min-h-11 border rounded-lg px-3 text-xs cursor-pointer"
                    style={controlStyle}
                    onClick={() => {
                      setLeftChoice({ metric: preset.left, source: null });
                      setRightChoice({ metric: preset.right, source: null });
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <MetricControl
                  side="Left"
                  metrics={data.metrics}
                  metric={left}
                  source={leftSource}
                  choice={leftChoice}
                  onChange={setLeftChoice}
                />
                <MetricControl
                  side="Right"
                  metrics={data.metrics}
                  metric={right}
                  source={rightSource}
                  choice={rightChoice}
                  onChange={setRightChoice}
                />
              </div>
              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                aria-label="Recorded-day coverage"
              >
                <Coverage metric={left} source={leftSource} days={days} />
                <Coverage metric={right} source={rightSource} days={days} />
              </div>
              <MetricComparisonChart points={points} left={left} right={right} />
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Gaps mean no data; a recorded zero remains zero. Values are not filled between days.
                Matching patterns do not establish a cause.
              </p>
              <details>
                <summary className="min-h-11 flex items-center text-sm cursor-pointer">
                  View daily values and missing days
                </summary>
                <div
                  className="overflow-x-auto rounded-lg border"
                  style={{ borderColor: 'var(--border-card)' }}
                >
                  <table className="w-full text-xs text-left">
                    <caption className="sr-only">
                      Daily recorded values in {data.time_zone}. No data means no observation from
                      the selected source.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className="p-2">
                          Date
                        </th>
                        <th scope="col" className="p-2">
                          {left.label}
                          {left.unit ? ` (${left.unit})` : ''} ·{' '}
                          {leftSource?.label ?? 'Choose source'}
                        </th>
                        <th scope="col" className="p-2">
                          {right.label}
                          {right.unit ? ` (${right.unit})` : ''} ·{' '}
                          {rightSource?.label ?? 'Choose source'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {points.map((point) => (
                        <tr key={point.date} style={{ borderTop: '1px solid var(--border-card)' }}>
                          <th scope="row" className="p-2 font-normal whitespace-nowrap">
                            {formatUtcDayYear(point.date)}
                          </th>
                          <td className="p-2">{comparisonValue(point.left, left.unit)}</td>
                          <td className="p-2">{comparisonValue(point.right, right.unit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
