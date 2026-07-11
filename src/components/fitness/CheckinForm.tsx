'use client';

import React, { useEffect, useState } from 'react';
import type { CheckinWire, LatestMeasurementWire } from '@/lib/fitness/api-types';

// ---------------------------------------------------------------------------
// Weekly check-in form (narratives + nutrition + neck/waist tape).
//
// PUT semantics are FULL REPLACEMENT: every manual field is prefilled from
// the existing row and always sent, so clearing a field clears it server-side.
// neck/waist are different — they write through to vitals dated to the
// submission day, so they are NOT prefilled (that would re-record the old
// tape measurement today); the latest known values show as placeholders and
// only user-entered values are sent.
// ---------------------------------------------------------------------------

export interface CheckinFormProps {
  weekStart: string;
  initial: CheckinWire | null;
  neckLatest: LatestMeasurementWire | null;
  waistLatest: LatestMeasurementWire | null;
  /** Receives the wire-shaped (snake_case) PUT body. Must throw on failure. */
  onSave: (body: Record<string, unknown>) => Promise<void>;
}

function numOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-primary)',
  borderColor: 'var(--border-card)',
  color: 'var(--color-text-primary)',
};
const fieldClass = 'w-full rounded-lg border px-2.5 py-1.5 text-sm';
const labelClass = 'text-xs font-medium';
const labelStyle: React.CSSProperties = { color: 'var(--color-text-muted)' };

export default function CheckinForm({
  weekStart,
  initial,
  neckLatest,
  waistLatest,
  onSave,
}: CheckinFormProps) {
  const [working, setWorking] = useState('');
  const [notWorking, setNotWorking] = useState('');
  const [daysLogged, setDaysLogged] = useState('');
  const [avgCalories, setAvgCalories] = useState('');
  const [avgProteinG, setAvgProteinG] = useState('');
  const [avgCarbsG, setAvgCarbsG] = useState('');
  const [avgFatG, setAvgFatG] = useState('');
  const [avgFiberG, setAvgFiberG] = useState('');
  const [neckIn, setNeckIn] = useState('');
  const [waistIn, setWaistIn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Re-prefill when navigating to another week (or after a refetch).
  useEffect(() => {
    setWorking(initial?.working ?? '');
    setNotWorking(initial?.not_working ?? '');
    setDaysLogged(initial?.days_logged?.toString() ?? '');
    setAvgCalories(initial?.avg_calories?.toString() ?? '');
    setAvgProteinG(initial?.avg_protein_g?.toString() ?? '');
    setAvgCarbsG(initial?.avg_carbs_g?.toString() ?? '');
    setAvgFatG(initial?.avg_fat_g?.toString() ?? '');
    setAvgFiberG(initial?.avg_fiber_g?.toString() ?? '');
    setNeckIn('');
    setWaistIn('');
    setError(null);
    setSaved(false);
  }, [initial, weekStart]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const body: Record<string, unknown> = {
      working: working.trim() === '' ? null : working,
      not_working: notWorking.trim() === '' ? null : notWorking,
      days_logged: numOrNull(daysLogged),
      avg_calories: numOrNull(avgCalories),
      avg_protein_g: numOrNull(avgProteinG),
      avg_carbs_g: numOrNull(avgCarbsG),
      avg_fat_g: numOrNull(avgFatG),
      avg_fiber_g: numOrNull(avgFiberG),
    };
    // Only send tape measurements the user actually entered (vitals
    // write-through is dated to today — see module doc).
    const neck = numOrNull(neckIn);
    const waist = numOrNull(waistIn);
    if (neck !== null) body.neck_in = neck;
    if (waist !== null) body.waist_in = waist;

    setSaving(true);
    try {
      await onSave(body);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save check-in');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" aria-label="Weekly check-in">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        Weekly check-in
      </h3>
      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        Saving replaces the whole check-in for this week — cleared fields clear on the
        server too.
      </p>

      <label className="block space-y-1">
        <span className={labelClass} style={labelStyle}>What&apos;s working</span>
        <textarea
          value={working}
          onChange={(e) => setWorking(e.target.value)}
          rows={2}
          className={fieldClass}
          style={inputStyle}
        />
      </label>
      <label className="block space-y-1">
        <span className={labelClass} style={labelStyle}>What&apos;s not</span>
        <textarea
          value={notWorking}
          onChange={(e) => setNotWorking(e.target.value)}
          rows={2}
          className={fieldClass}
          style={inputStyle}
        />
      </label>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Days logged (0–7)</span>
          <input
            type="number"
            min={0}
            max={7}
            value={daysLogged}
            onChange={(e) => setDaysLogged(e.target.value)}
            className={fieldClass}
            style={inputStyle}
          />
        </label>
        {(
          [
            ['Avg calories', avgCalories, setAvgCalories],
            ['Avg protein (g)', avgProteinG, setAvgProteinG],
            ['Avg carbs (g)', avgCarbsG, setAvgCarbsG],
            ['Avg fat (g)', avgFatG, setAvgFatG],
            ['Avg fiber (g)', avgFiberG, setAvgFiberG],
          ] as const
        ).map(([label, value, setter]) => (
          <label key={label} className="space-y-1">
            <span className={labelClass} style={labelStyle}>{label}</span>
            <input
              type="number"
              min={0}
              step="any"
              value={value}
              onChange={(e) => setter(e.target.value)}
              className={fieldClass}
              style={inputStyle}
            />
          </label>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Neck (in) — recorded today</span>
          <input
            type="number"
            min={0}
            step="any"
            value={neckIn}
            onChange={(e) => setNeckIn(e.target.value)}
            placeholder={neckLatest ? `latest ${neckLatest.value}` : 'not measured yet'}
            className={fieldClass}
            style={inputStyle}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Waist (in) — recorded today</span>
          <input
            type="number"
            min={0}
            step="any"
            value={waistIn}
            onChange={(e) => setWaistIn(e.target.value)}
            placeholder={waistLatest ? `latest ${waistLatest.value}` : 'not measured yet'}
            className={fieldClass}
            style={inputStyle}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm" style={{ color: 'var(--color-sage)' }}>
          Check-in saved.
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-60"
        style={{ backgroundColor: 'var(--color-sage)', color: 'var(--bg-primary)' }}
      >
        {saving ? 'Saving…' : initial ? 'Update check-in' : 'Save check-in'}
      </button>
    </form>
  );
}
