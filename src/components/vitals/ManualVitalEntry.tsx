'use client';

import React, { useState } from 'react';
import type { Vital } from '@/lib/types';
import { useProfile } from '@/hooks/useProfile';
import { weightToLbs } from '@/lib/units';

interface ManualVitalEntryProps {
  onSubmit: (vital: Omit<Vital, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
}

interface MetricConfig {
  label: string;
  key: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

const METRICS: MetricConfig[] = [
  { label: 'Resting HR', key: 'resting_hr', unit: 'bpm', min: 20, max: 250, step: 1 },
  { label: 'HRV', key: 'hrv', unit: 'ms', min: 0, max: 300, step: 1 },
  { label: 'SpO2', key: 'spo2', unit: '%', min: 50, max: 100, step: 0.1 },
  { label: 'Blood Pressure (Systolic)', key: 'bp_systolic', unit: 'mmHg', min: 50, max: 300, step: 1 },
  { label: 'Blood Pressure (Diastolic)', key: 'bp_diastolic', unit: 'mmHg', min: 20, max: 200, step: 1 },
  { label: 'Weight', key: 'weight', unit: 'lbs', min: 0, max: 1500, step: 0.1 },
  { label: 'Sleep Duration', key: 'sleep_duration', unit: 'hours', min: 0, max: 24, step: 0.1 },
  { label: 'Steps', key: 'steps', unit: 'steps', min: 0, max: 200000, step: 1 },
  { label: 'AHI', key: 'ahi', unit: 'events/hr', min: 0, max: 200, step: 0.1 },
  { label: 'Sleep Score', key: 'sleep_score', unit: 'score', min: 0, max: 100, step: 1 },
];

function toLocalDatetimeString(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export default function ManualVitalEntry({ onSubmit }: ManualVitalEntryProps) {
  const { profile } = useProfile();
  const unitSystem = profile?.unit_system ?? 'imperial';

  const [selectedMetricIndex, setSelectedMetricIndex] = useState(0);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(METRICS[0].unit);
  const [recordedAt, setRecordedAt] = useState(toLocalDatetimeString(new Date()));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const metric = METRICS[selectedMetricIndex];

  // Override unit for weight based on user preference
  const effectiveUnit = metric.key === 'weight'
    ? (unitSystem === 'metric' ? 'kg' : 'lbs')
    : metric.unit;

  function handleMetricChange(index: number) {
    setSelectedMetricIndex(index);
    const m = METRICS[index];
    setUnit(m.key === 'weight' ? (unitSystem === 'metric' ? 'kg' : 'lbs') : m.unit);
    setValue('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const numVal = parseFloat(value);
    if (isNaN(numVal)) {
      setError('Please enter a valid number.');
      return;
    }

    setSubmitting(true);
    try {
      // Convert weight to lbs for DB storage if user entered in kg
      const dbValue = metric.key === 'weight' && unitSystem === 'metric'
        ? weightToLbs(numVal, 'metric')
        : numVal;

      await onSubmit({
        metric_key: metric.key,
        value: dbValue,
        unit: metric.key === 'weight' ? 'lbs' : unit, // Always store weight as lbs
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

      {/* Metric selector */}
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
          value={selectedMetricIndex}
          onChange={(e) => handleMetricChange(parseInt(e.target.value, 10))}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{
            backgroundColor: 'var(--bg-primary)',
            borderColor: 'var(--border-card)',
            color: 'var(--color-text-primary)',
            colorScheme: 'dark',
          }}
        >
          {METRICS.map((m, i) => (
            <option key={m.key} value={i}>
              {m.label}
            </option>
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
          <input
            id="vital-value"
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            min={metric.min}
            max={metric.max}
            step={metric.step}
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
        </div>
        <div>
          <label
            htmlFor="vital-unit"
            className="text-sm font-medium mb-1 block"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Unit
          </label>
          <input
            id="vital-unit"
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'var(--bg-primary)',
              borderColor: 'var(--border-card)',
              color: 'var(--color-text-primary)',
            }}
          />
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
