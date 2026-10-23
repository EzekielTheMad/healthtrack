'use client';

import { useState } from 'react';
import type { LabResult, LabVisit } from '@/lib/types';
import type { LabVisitUpdates } from '@/hooks/useLabResults';
import { isValidDayKey } from '@/lib/dates';

type DraftResult = Omit<LabResult, 'value' | 'reference_range_low' | 'reference_range_high'> & {
  value: string;
  reference_range_low: string;
  reference_range_high: string;
};

interface Props {
  visit: LabVisit & { results: LabResult[] };
  onSave: (id: string, updates: LabVisitUpdates) => Promise<void>;
  onCancel: () => void;
}

export default function LabVisitEditor({ visit, onSave, onCancel }: Props) {
  const [visitDate, setVisitDate] = useState(visit.visit_date);
  const [notes, setNotes] = useState(visit.notes ?? '');
  const [reason, setReason] = useState('');
  const [results, setResults] = useState<DraftResult[]>(() =>
    visit.results.map((row) => ({
      ...row,
      value: String(row.value),
      reference_range_low: row.reference_range_low === null ? '' : String(row.reference_range_low),
      reference_range_high:
        row.reference_range_high === null ? '' : String(row.reference_range_high),
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputClass =
    'w-full rounded-lg border px-3 py-2 text-sm bg-bg-primary border-border-card text-text-primary';

  function change(index: number, field: keyof DraftResult, value: string) {
    setResults((previous) =>
      previous.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!isValidDayKey(visitDate)) {
      setError('Enter a valid collection / visit date.');
      return;
    }
    const updates: LabVisitUpdates = {};
    if (visitDate !== visit.visit_date) updates.visit_date = visitDate;
    if (notes !== (visit.notes ?? '')) updates.notes = notes.trim() || null;
    updates.results = [];
    for (const [index, row] of results.entries()) {
      if (!row.test_name.trim() || row.value.trim() === '' || !Number.isFinite(Number(row.value))) {
        setError(
          `Result ${index + 1} needs a test name and numeric value. Blank values are not zero.`
        );
        return;
      }
      const low = row.reference_range_low.trim() === '' ? null : Number(row.reference_range_low);
      const high = row.reference_range_high.trim() === '' ? null : Number(row.reference_range_high);
      if (
        (low !== null && !Number.isFinite(low)) ||
        (high !== null && !Number.isFinite(high)) ||
        (low !== null && high !== null && low > high)
      ) {
        setError(`Result ${index + 1} has an invalid reference range.`);
        return;
      }
      const values = {
        panel_name: row.panel_name?.trim() || null,
        test_name: row.test_name.trim(),
        value: Number(row.value),
        unit: row.unit?.trim() || null,
        reference_range_low: low,
        reference_range_high: high,
        reference_range_text: row.reference_range_text?.trim() || null,
        flag: row.flag || null,
      };
      const original = visit.results[index];
      const changed = Object.entries(values).filter(
        ([key, value]) => value !== original[key as keyof LabResult]
      );
      if (changed.length) updates.results.push({ id: row.id, ...Object.fromEntries(changed) });
    }
    if (updates.results.length === 0) delete updates.results;
    if (Object.keys(updates).length === 0) {
      onCancel();
      return;
    }
    if (reason.trim()) updates.reason = reason.trim();
    setSaving(true);
    try {
      await onSave(visit.id, updates);
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save lab corrections');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 p-4" aria-label="Edit saved lab visit" noValidate>
      <p className="text-sm text-text-muted">
        Correct the saved values against the original report. Changes retain the source document and
        correction history.
      </p>
      <label className="block text-sm">
        Collection / visit date
        <input
          type="date"
          value={visitDate}
          onChange={(event) => setVisitDate(event.target.value)}
          className={inputClass}
        />
      </label>
      {results.map((row, index) => (
        <fieldset key={row.id} className="rounded-lg border border-border-card p-3 space-y-3">
          <legend className="px-1 text-sm font-semibold">
            {row.test_name || `Result ${index + 1}`}
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(
              [
                ['test_name', 'Test name', 'text'],
                ['panel_name', 'Panel', 'text'],
                ['value', 'Value', 'number'],
                ['unit', 'Unit', 'text'],
                ['reference_range_low', 'Reference low', 'number'],
                ['reference_range_high', 'Reference high', 'number'],
                ['reference_range_text', 'Reference range text', 'text'],
              ] as const
            ).map(([field, label, type]) => (
              <label key={field} className="block text-sm">
                {label}
                <input
                  aria-label={`Result ${index + 1} ${label.toLowerCase()}`}
                  type={type}
                  step={type === 'number' ? 'any' : undefined}
                  value={row[field] ?? ''}
                  onChange={(event) => change(index, field, event.target.value)}
                  className={inputClass}
                />
              </label>
            ))}
            <label className="block text-sm">
              Flag
              <select
                aria-label={`Result ${index + 1} flag`}
                value={row.flag ?? ''}
                onChange={(event) => change(index, 'flag', event.target.value)}
                className={inputClass}
              >
                <option value="">Unknown / not reported</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="low">Low</option>
                <option value="critical">Critical</option>
              </select>
            </label>
          </div>
        </fieldset>
      ))}
      <label className="block text-sm">
        Visit notes
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={inputClass}
          rows={2}
        />
      </label>
      <label className="block text-sm">
        Reason for correction (optional)
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-accent-red">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-accent-green px-4 py-2 text-bg-primary disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save corrections'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="rounded-lg border border-border-card px-4 py-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
