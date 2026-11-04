'use client';

import { useState } from 'react';
import { getMetric } from '@/lib/metrics/registry';
import type { VitalSourceConflict, VitalSourcePreferences } from '@/lib/metrics/source-selection';
import { vitalSourceLabel } from '@/lib/metrics/source-label';

export default function SourcePreferencesPanel({
  conflicts,
  preferences,
  onChoose,
  disabled = false,
  error,
  labels = {},
}: {
  conflicts: VitalSourceConflict[];
  preferences: VitalSourcePreferences;
  onChoose: (metricKey: string, source: string | null) => Promise<void>;
  disabled?: boolean;
  error?: string | null;
  labels?: Readonly<Record<string, string>>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const sourceLabel = (source: string) =>
    Object.hasOwn(labels, source) ? labels[source] : vitalSourceLabel(source);
  const competing = conflicts.filter((c) => c.sources.length > 1 || preferences[c.metricKey]);
  if (!competing.length && !error) return null;
  return (
    <section
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--border-card)', background: 'var(--bg-card)' }}
    >
      <h2 className="font-semibold text-sm">Measurement sources</h2>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Choose one source per metric for trends and summaries. Different devices are never added
        together.
        {disabled
          ? ' Source choices are available in your own record. Competing sources in other profiles are omitted.'
          : ''}
      </p>
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}
      {competing.map((conflict) => (
        <div className="flex flex-wrap items-center gap-2 justify-between" key={conflict.metricKey}>
          <label htmlFor={`source-${conflict.metricKey}`} className="text-sm">
            {getMetric(conflict.metricKey)?.label ?? conflict.metricKey}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {conflict.needsChoice && (
              <span className="text-xs" style={{ color: 'var(--color-warning)' }}>
                Choose a source to show this metric
              </span>
            )}
            {conflict.selectedSource && !conflict.sources.includes(conflict.selectedSource) && (
              <span className="text-xs" style={{ color: 'var(--color-warning)' }}>
                Selected source has no readings in this window
              </span>
            )}
            <select
              id={`source-${conflict.metricKey}`}
              aria-label={`Source for ${getMetric(conflict.metricKey)?.label ?? conflict.metricKey}`}
              className="border rounded-lg px-2 py-2 text-sm max-w-full"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
              disabled={disabled || saving !== null}
              value={preferences[conflict.metricKey] ?? ''}
              onChange={async (event) => {
                const source = event.target.value || null;
                setSaving(conflict.metricKey);
                try {
                  await onChoose(conflict.metricKey, source);
                } finally {
                  setSaving(null);
                }
              }}
            >
              <option value="">
                Automatic
                {conflict.selectedSource && !preferences[conflict.metricKey]
                  ? ` (${sourceLabel(conflict.selectedSource)})`
                  : ' — choose a source'}
              </option>
              {[
                ...new Set([
                  ...conflict.sources,
                  ...(preferences[conflict.metricKey] ? [preferences[conflict.metricKey]] : []),
                ]),
              ].map((source) => (
                <option key={source} value={source}>
                  {sourceLabel(source)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </section>
  );
}
