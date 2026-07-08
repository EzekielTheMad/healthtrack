'use client';

import { useState } from 'react';
import type { ParsedVaccineRecord } from '@/lib/claude/parse-vaccine-pdf';

interface VaccineImportReviewProps {
  records: ParsedVaccineRecord[];
  onSave: (records: ParsedVaccineRecord[]) => Promise<void>;
  onCancel: () => void;
}

export default function VaccineImportReview({
  records,
  onSave,
  onCancel,
}: VaccineImportReviewProps) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(records.map((_, i) => i)),
  );
  const [saving, setSaving] = useState(false);

  const toggle = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const handleSave = async () => {
    const toSave = records.filter((_, i) => selected.has(i));
    if (toSave.length === 0) return;
    setSaving(true);
    try {
      await onSave(toSave);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Review Imported Vaccines ({records.length} found)
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer"
            style={{ color: 'var(--color-text-muted)', border: '1px solid var(--border-card)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || selected.size === 0}
            className="px-4 py-1.5 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))',
              color: 'white',
            }}
          >
            {saving ? 'Saving...' : `Save ${selected.size} vaccine${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Uncheck any records you don&apos;t want to import. Duplicates of existing records will be skipped.
      </p>

      <div className="space-y-2">
        {records.map((rec, idx) => (
          <label
            key={idx}
            className="flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors"
            style={{
              backgroundColor: selected.has(idx) ? 'var(--bg-card)' : 'transparent',
              borderColor: selected.has(idx) ? 'var(--color-sage)' : 'var(--border-card)',
              opacity: selected.has(idx) ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(idx)}
              onChange={() => toggle(idx)}
              className="mt-1 accent-[var(--color-sage)]"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {rec.name}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                {rec.vaccine_date && (
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(rec.vaccine_date + 'T00:00:00').toLocaleDateString()}
                  </span>
                )}
                {rec.dose_number && (
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Dose {rec.dose_number}
                    {rec.series_doses ? ` of ${rec.series_doses}` : ''}
                  </span>
                )}
                {rec.manufacturer && (
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {rec.manufacturer}
                  </span>
                )}
                {rec.lot_number && (
                  <span className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
                    Lot: {rec.lot_number}
                  </span>
                )}
              </div>
              {rec.notes && (
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {rec.notes}
                </p>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
