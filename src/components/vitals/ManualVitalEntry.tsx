'use client';

import React, { useState } from 'react';
import type { Vital } from '@/lib/types';
import { useProfile } from '@/hooks/useProfile';
import { weightToLbs } from '@/lib/units';
import {
  METRICS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  getMetric,
  type MetricDef,
} from '@/lib/metrics/registry';

interface ManualVitalEntryProps {
  onSubmit: (vital: Omit<Vital, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
}

// Section order for the metric dropdown's optgroups comes from the registry.
const METRIC_GROUPS = CATEGORY_ORDER.map((category) => ({
  category,
  label: CATEGORY_LABELS[category],
  metrics: METRICS.filter((m) => m.category === category),
})).filter((g) => g.metrics.length > 0);

/** Input constraints for well-known metrics (carried over from the original list). */
const INPUT_CONSTRAINTS: Record<string, { min: number; max: number; step: number }> = {
  resting_hr: { min: 20, max: 250, step: 1 },
  hrv_rmssd: { min: 0, max: 300, step: 1 },
  spo2: { min: 50, max: 100, step: 0.1 },
  bp_systolic: { min: 50, max: 300, step: 1 },
  bp_diastolic: { min: 20, max: 200, step: 1 },
  weight: { min: 0, max: 1500, step: 0.1 },
  sleep_duration: { min: 0, max: 24, step: 0.1 },
  steps: { min: 0, max: 200000, step: 1 },
  ahi: { min: 0, max: 200, step: 0.1 },
  sleep_score: { min: 0, max: 100, step: 1 },
  pain_level: { min: 0, max: 10, step: 1 },
};

function constraintsFor(m: MetricDef): { min: number; max: number; step: number } {
  return (
    INPUT_CONSTRAINTS[m.key] ?? {
      min: m.min ?? 0,
      max: m.max ?? 1000000,
      step: (m.decimals ?? 0) > 0 ? 0.1 : 1,
    }
  );
}

function toLocalDatetimeString(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export default function ManualVitalEntry({ onSubmit }: ManualVitalEntryProps) {
  const { profile } = useProfile();
  const unitSystem = profile?.unit_system ?? 'imperial';

  const [metricKey, setMetricKey] = useState(METRICS[0].key);
  const [value, setValue] = useState('');
  const [recordedAt, setRecordedAt] = useState(toLocalDatetimeString(new Date()));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const metric = getMetric(metricKey) ?? METRICS[0];
  const isOrdinal = metric.valueType === 'ordinal';
  const ordinalLabels = metric.ordinalLabels ?? [];
  const constraints = constraintsFor(metric);

  // Unit hint from the registry; weight follows the user's unit preference
  // (entered kg values are converted to the canonical lbs before saving).
  const entryUnit =
    metric.key === 'weight' ? (unitSystem === 'metric' ? 'kg' : 'lbs') : (metric.unit ?? '');

  function handleMetricChange(key: string) {
    setMetricKey(key);
    setValue('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const numVal = isOrdinal ? parseInt(value, 10) : parseFloat(value);
    if (isNaN(numVal)) {
      setError(isOrdinal ? 'Please choose a value.' : 'Please enter a valid number.');
      return;
    }

    setSubmitting(true);
    try {
      // Convert weight to lbs for DB storage if user entered in kg
      const dbValue =
        metric.key === 'weight' && unitSystem === 'metric'
          ? weightToLbs(numVal, 'metric')
          : numVal;

      await onSubmit({
        metric_key: metric.key,
        value: dbValue,
        unit: metric.unit, // canonical stored unit from the registry
        source: 'manual',
        recorded_at: new Date(recordedAt).toISOString(),
        metadata: {},
      });

      setValue('');
      setRecordedAt(toLocalDatetimeString(new Date()));
    } catch {
      setError('Failed to save vital reading.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border p-5 space-y-4"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      aria-label="Record a vital reading"
    >
      <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        Record Vital
      </h2>

      {/* Metric selector, grouped by registry category */}
      <div>
        <label
          htmlFor="vital-metric"
          className="text-sm font-medium mb-1 block"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Metric
        </label>
        <select
          id="vital-metric"
          value={metricKey}
          onChange={(e) => handleMetricChange(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{
            backgroundColor: 'var(--bg-primary)',
            borderColor: 'var(--border-card)',
            color: 'var(--color-text-primary)',
            colorScheme: 'dark',
          }}
        >
          {METRIC_GROUPS.map((group) => (
            <optgroup key={group.category} label={group.label}>
              {group.metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Value and unit row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="vital-value"
            className="text-sm font-medium mb-1 block"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Value
          </label>
          {isOrdinal ? (
            <select
              id="vital-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderColor: error ? 'var(--color-terracotta)' : 'var(--border-card)',
                color: 'var(--color-text-primary)',
                colorScheme: 'dark',
              }}
              aria-invalid={!!error}
              aria-describedby={error ? 'vital-error' : undefined}
            >
              <option value="" disabled>
                Select…
              </option>
              {ordinalLabels.map((label, i) => (
                <option key={label} value={i + 1}>
                  {label} ({i + 1}/{ordinalLabels.length})
                </option>
              ))}
            </select>
          ) : (
            <input
              id="vital-value"
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              min={constraints.min}
              max={constraints.max}
              step={constraints.step}
              required
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderColor: error ? 'var(--color-terracotta)' : 'var(--border-card)',
                color: 'var(--color-text-primary)',
                colorScheme: 'dark',
              }}
              aria-invalid={!!error}
              aria-describedby={error ? 'vital-error' : undefined}
            />
          )}
        </div>
        <div>
          <span
            className="text-sm font-medium mb-1 block"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Unit
          </span>
          <div
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{
              backgroundColor: 'var(--bg-primary)',
              borderColor: 'var(--border-card)',
              color: 'var(--color-text-muted)',
            }}
            aria-label="Unit"
          >
            {isOrdinal ? `1–${ordinalLabels.length} scale` : entryUnit || '—'}
          </div>
        </div>
      </div>

      {error && (
        <p id="vital-error" className="text-xs" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}

      {/* Date/time */}
      <div>
        <label
          htmlFor="vital-datetime"
          className="text-sm font-medium mb-1 block"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Date & Time
        </label>
        <input
          id="vital-datetime"
          type="datetime-local"
          value={recordedAt}
          onChange={(e) => setRecordedAt(e.target.value)}
          required
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{
            backgroundColor: 'var(--bg-primary)',
            borderColor: 'var(--border-card)',
            color: 'var(--color-text-primary)',
            colorScheme: 'dark',
          }}
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="px-5 py-2.5 rounded-lg text-sm font-medium transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: 'var(--color-sage)',
          color: 'var(--color-bark)',
        }}
      >
        {submitting ? 'Recording...' : 'Record'}
      </button>
    </form>
  );
}
