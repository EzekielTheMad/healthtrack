'use client';

import React, { useState } from 'react';
import type {
  CheckinWire,
  LatestMeasurementWire,
  ImportedNutritionSummary,
  WeekRollupWire,
} from '@/lib/fitness/api-types';
import { formatDateOnly, formatUtcDayYear, shiftDayKey } from '@/lib/dates';
import { getMetric } from '@/lib/metrics/registry';
import { nutritionSourceLabel } from '@/lib/nutrition/sources';

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
  importedNutrition?: ImportedNutritionSummary[];
  nutritionUnavailable?: boolean;
  bodySummary?: Pick<WeekRollupWire['body'], 'weight_avg' | 'days_weighed' | 'measurements_latest'>;
  /** A parent may keep confirmation visible while refreshing/remounting the form. */
  showSaveConfirmation?: boolean;
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

export default function CheckinForm(props: CheckinFormProps) {
  // A week/record change starts a new draft; ordinary parent refreshes preserve it.
  return <CheckinDraft key={`${props.weekStart}:${props.initial?.id ?? 'new'}`} {...props} />;
}

function CheckinDraft({
  weekStart,
  initial,
  neckLatest,
  waistLatest,
  importedNutrition = [],
  nutritionUnavailable = false,
  bodySummary,
  showSaveConfirmation = true,
  onSave,
}: CheckinFormProps) {
  const [working, setWorking] = useState(initial?.working ?? '');
  const [notWorking, setNotWorking] = useState(initial?.not_working ?? '');
  const [daysLogged, setDaysLogged] = useState(initial?.days_logged?.toString() ?? '');
  const [avgCalories, setAvgCalories] = useState(initial?.avg_calories?.toString() ?? '');
  const [avgProteinG, setAvgProteinG] = useState(initial?.avg_protein_g?.toString() ?? '');
  const [avgCarbsG, setAvgCarbsG] = useState(initial?.avg_carbs_g?.toString() ?? '');
  const [avgFatG, setAvgFatG] = useState(initial?.avg_fat_g?.toString() ?? '');
  const [avgFiberG, setAvgFiberG] = useState(initial?.avg_fiber_g?.toString() ?? '');
  const [neckIn, setNeckIn] = useState('');
  const [waistIn, setWaistIn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [step, setStep] = useState(1);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step < 3) {
      nextStep();
      return;
    }
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
      setNeckIn('');
      setWaistIn('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save check-in');
    } finally {
      setSaving(false);
    }
  }

  function nextStep() {
    setError(null);
    setSaved(false);
    if (step === 2) {
      const numericFields = [
        daysLogged,
        avgCalories,
        avgProteinG,
        avgCarbsG,
        avgFatG,
        avgFiberG,
        neckIn,
        waistIn,
      ];
      if (
        numericFields.some(
          (value) => value.trim() !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)
        )
      ) {
        setError('Enter non-negative numbers, or leave unknown values blank.');
        return;
      }
      if (
        daysLogged.trim() !== '' &&
        (!Number.isInteger(Number(daysLogged)) || Number(daysLogged) > 7)
      ) {
        setError('Days logged must be a whole number from 0 to 7.');
        return;
      }
    }
    setStep((current) => Math.min(3, current + 1));
  }

  const manualAverages = [
    ['Calories', avgCalories],
    ['Protein (g)', avgProteinG],
    ['Carbs (g)', avgCarbsG],
    ['Fat (g)', avgFatG],
    ['Fiber (g)', avgFiberG],
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-3" aria-label="Weekly check-in">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        Weekly check-in
      </h3>
      <ol aria-label="Check-in progress" className="flex flex-wrap gap-3 text-xs">
        {['Review data', 'Your check-in', 'Confirm & save'].map((label, index) => (
          <li
            key={label}
            aria-current={step === index + 1 ? 'step' : undefined}
            className={step === index + 1 ? 'font-semibold text-accent-green' : 'text-text-muted'}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-4" aria-label="Review imported week">
          <p className="text-sm">
            {formatDateOnly(weekStart)} – {formatDateOnly(shiftDayKey(weekStart, 6))}
          </p>
          {bodySummary && (
            <section
              className="rounded-lg border border-border-card p-3 space-y-2"
              aria-label="Weight and tape review"
            >
              <p className="text-sm">
                7-day weight average:{' '}
                <strong>
                  {bodySummary.weight_avg === null ? 'No data' : `${bodySummary.weight_avg} lb`}
                </strong>{' '}
                · {bodySummary.days_weighed}/7 days weighed
              </p>
              {Object.entries(bodySummary.measurements_latest ?? {}).map(([key, measurement]) => (
                <p key={key} className="text-xs text-text-muted">
                  {getMetric(key)?.label ?? key}: {measurement.value} {measurement.unit ?? 'in'} ·
                  measured {formatUtcDayYear(measurement.recorded_at)} · {measurement.source}
                </p>
              ))}
              {Object.keys(bodySummary.measurements_latest ?? {}).length === 0 && (
                <p className="text-xs text-text-muted">No tape measurements on record.</p>
              )}
            </section>
          )}
          <section aria-label="Imported nutrition" className="space-y-3">
            <h4 className="text-sm font-semibold">Imported nutrition averages</h4>
            <p className="text-xs text-text-muted">
              Each source is shown separately. Averages include reported values only; missing days
              and nutrients are unknown.
            </p>
            {importedNutrition.length === 0 && (
              <p className="text-sm text-text-muted">
                {nutritionUnavailable
                  ? 'Imported nutrition is unavailable for this profile.'
                  : 'No imported nutrition for this week.'}{' '}
                You can still enter manual averages.
              </p>
            )}
            {importedNutrition.map((nutrition) => (
              <div
                key={nutrition.source_package}
                className="rounded-lg border border-border-card p-3 space-y-2"
              >
                <p className="text-sm font-semibold">
                  {nutritionSourceLabel(nutrition.source_package)} · {nutrition.days_recorded}/7
                  days recorded
                </p>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  {(
                    [
                      ['Calories', nutrition.calories_avg, 'calories'],
                      ['Protein (g)', nutrition.protein_grams_avg, 'protein_grams'],
                      ['Carbs (g)', nutrition.carbs_grams_avg, 'carbs_grams'],
                      ['Fat (g)', nutrition.fat_grams_avg, 'fat_grams'],
                      ['Fiber (g)', nutrition.fiber_grams_avg, 'fiber_grams'],
                    ] as const
                  ).map(([label, value, key]) => (
                    <div key={key}>
                      <dt className="text-text-muted">{label}</dt>
                      <dd>
                        {value === null ? 'Unknown' : Number(value.toFixed(1))} ·{' '}
                        {nutrition.numeric_samples[key]}/7 days
                      </dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  className="text-sm underline text-accent-green"
                  onClick={() => {
                    setDaysLogged(String(nutrition.days_recorded));
                    setAvgCalories(nutrition.calories_avg?.toString() ?? '');
                    setAvgProteinG(nutrition.protein_grams_avg?.toString() ?? '');
                    setAvgCarbsG(nutrition.carbs_grams_avg?.toString() ?? '');
                    setAvgFatG(nutrition.fat_grams_avg?.toString() ?? '');
                    setAvgFiberG(nutrition.fiber_grams_avg?.toString() ?? '');
                  }}
                >
                  Use {nutritionSourceLabel(nutrition.source_package)} averages
                </button>
              </div>
            ))}
          </section>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3" aria-label="Your check-in details">
          <p className="text-xs text-text-muted">
            Review your notes and manual averages. Leave unknown values blank. Only enter tape
            readings measured today.
          </p>

          <label className="block space-y-1">
            <span className={labelClass} style={labelStyle}>
              What&apos;s working
            </span>
            <textarea
              value={working}
              onChange={(e) => setWorking(e.target.value)}
              rows={2}
              className={fieldClass}
              style={inputStyle}
            />
          </label>
          <label className="block space-y-1">
            <span className={labelClass} style={labelStyle}>
              What&apos;s not
            </span>
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
              <span className={labelClass} style={labelStyle}>
                Days logged (0–7)
              </span>
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
                <span className={labelClass} style={labelStyle}>
                  {label}
                </span>
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
              <span className={labelClass} style={labelStyle}>
                Neck (in) — recorded today
              </span>
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
              <span className={labelClass} style={labelStyle}>
                Waist (in) — recorded today
              </span>
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
        </div>
      )}

      {step === 3 && (
        <section className="space-y-3" aria-label="Confirm check-in">
          <h4 className="text-sm font-semibold">Review before saving</h4>
          <p className="text-xs text-text-muted">
            This updates the saved notes and manual averages for this week. Clearing a previously
            saved field removes that value.
          </p>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-text-muted">What&apos;s working</dt>
              <dd className="whitespace-pre-wrap">{working || 'Not entered'}</dd>
            </div>
            <div>
              <dt className="text-text-muted">What&apos;s not</dt>
              <dd className="whitespace-pre-wrap">{notWorking || 'Not entered'}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Days logged</dt>
              <dd>{daysLogged || 'Unknown'}</dd>
            </div>
            {manualAverages.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-text-muted">{label}</dt>
                <dd>{value || 'Unknown'}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-text-muted">
            New tape readings for today: {neckIn ? `neck ${neckIn} in` : 'no neck reading'};{' '}
            {waistIn ? `waist ${waistIn} in` : 'no waist reading'}. Existing measurements are not
            recorded again.
          </p>
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}
      {showSaveConfirmation && saved && !error && (
        <p role="status" className="text-sm" style={{ color: 'var(--color-sage)' }}>
          Check-in saved.
        </p>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        {step > 1 && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setStep((current) => current - 1);
              setSaved(false);
              setError(null);
            }}
            className="rounded-lg border border-border-card px-4 py-2 text-sm"
          >
            Back
          </button>
        )}
        {step < 3 ? (
          <button
            key="continue"
            type="button"
            onClick={(event) => {
              event.preventDefault();
              nextStep();
            }}
            className="rounded-lg bg-accent-green px-4 py-2 text-sm text-bg-primary"
          >
            Continue
          </button>
        ) : (
          <button
            key="save"
            type="submit"
            disabled={saving || saved}
            className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-60"
            style={{ backgroundColor: 'var(--color-sage)', color: 'var(--bg-primary)' }}
          >
            {saving ? 'Saving…' : initial ? 'Update check-in' : 'Save check-in'}
          </button>
        )}
      </div>
    </form>
  );
}
