'use client';

import { useState } from 'react';
import type { Medication, MedicationFrequency } from '@/lib/types';
import AddMedForm, { type AddMedFormData } from './AddMedForm';

const FREQUENCY_LABELS: Record<string, string> = {
  once_daily: 'Once Daily',
  twice_daily: 'Twice Daily',
  three_times_daily: 'Three Times Daily',
  four_times_daily: 'Four Times Daily',
  every_other_day: 'Every Other Day',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  as_needed: 'As Needed',
  other: 'Other',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface MedCardProps {
  medication: Medication;
  onUpdate: (id: string, data: AddMedFormData) => Promise<void>;
}

export default function MedCard({ medication, onUpdate }: MedCardProps) {
  const [editing, setEditing] = useState(false);

  const handleUpdate = async (data: AddMedFormData) => {
    await onUpdate(medication.id, data);
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="rounded-xl border p-5"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        role="article"
        aria-label={`Editing ${medication.name}`}
      >
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
          Edit Medication
        </h3>
        <AddMedForm
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
          submitLabel="Save Changes"
          showActiveToggle
          initialValues={{
            name: medication.name,
            dosage: medication.dosage ?? undefined,
            frequency: (medication.frequency as MedicationFrequency) ?? 'once_daily',
            category: medication.category ?? undefined,
            prescriber_id: medication.prescriber_id,
            start_date: medication.start_date ?? new Date().toISOString().slice(0, 10),
            end_date: medication.end_date ?? undefined,
            notes: medication.notes ?? undefined,
            active: medication.active,
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border p-5"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      role="article"
      aria-label={`${medication.name} medication card`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* Status dot */}
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: medication.active ? 'var(--color-sage)' : 'var(--color-text-muted)' }}
              aria-label={medication.active ? 'Active' : 'Inactive'}
            />
            <h3 className="text-base font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {medication.name}
            </h3>
          </div>

          {/* Dosage + frequency */}
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {medication.dosage && (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {medication.dosage}
              </span>
            )}
            {medication.dosage && medication.frequency && (
              <span style={{ color: 'var(--border-card)' }}>|</span>
            )}
            {medication.frequency && (
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {FREQUENCY_LABELS[medication.frequency] ?? medication.frequency}
              </span>
            )}
          </div>

          {/* Category badge */}
          {medication.category && (
            <span
              className="inline-block text-xs px-2 py-0.5 rounded-full mt-2"
              style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-sage)' }}
            >
              {medication.category}
            </span>
          )}

          {/* Dates */}
          <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {medication.start_date && (
              <span>Started {formatDate(medication.start_date)}</span>
            )}
            {medication.end_date && (
              <span>Ended {formatDate(medication.end_date)}</span>
            )}
          </div>

          {/* Prescriber placeholder (ID shown; full resolution would need a join) */}
          {medication.prescriber_id && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Prescriber on file
            </p>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-sage)' }}
            aria-label={`Edit ${medication.name}`}
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}
