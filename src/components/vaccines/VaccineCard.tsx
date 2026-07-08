'use client';

import { useState } from 'react';
import type { Vaccine } from '@/lib/types';
import AddVaccineForm, { type AddVaccineFormData } from './AddVaccineForm';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface VaccineCardProps {
  vaccine: Vaccine;
  onUpdate: (id: string, updates: Partial<Vaccine>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function VaccineCard({ vaccine, onUpdate, onDelete }: VaccineCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleUpdate = async (data: AddVaccineFormData) => {
    await onUpdate(vaccine.id, {
      name: data.name,
      cvx_code: data.cvx_code ?? null,
      vaccine_date: data.vaccine_date,
      dose_number: data.dose_number ?? null,
      series_doses: data.series_doses ?? null,
      manufacturer: data.manufacturer?.trim() || null,
      lot_number: data.lot_number?.trim() || null,
      provider_id: data.provider_id ?? null,
      next_dose_date: data.next_dose_date?.trim() || null,
      notes: data.notes?.trim() || null,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="rounded-xl border p-5"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
          Edit Vaccine
        </h3>
        <AddVaccineForm
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
          submitLabel="Save Changes"
          initialValues={{
            name: vaccine.name,
            cvx_code: vaccine.cvx_code,
            vaccine_date: vaccine.vaccine_date,
            dose_number: vaccine.dose_number,
            series_doses: vaccine.series_doses,
            manufacturer: vaccine.manufacturer ?? '',
            lot_number: vaccine.lot_number ?? '',
            provider_id: vaccine.provider_id,
            next_dose_date: vaccine.next_dose_date ?? '',
            notes: vaccine.notes ?? '',
          }}
        />
      </div>
    );
  }

  const doseBadge =
    vaccine.dose_number != null
      ? vaccine.series_doses != null
        ? `Dose ${vaccine.dose_number} of ${vaccine.series_doses}`
        : `Dose ${vaccine.dose_number}`
      : null;

  return (
    <div
      className="rounded-xl border p-5"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3
              className="text-base font-semibold truncate"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {vaccine.name}
            </h3>
            {doseBadge && (
              <span
                className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-sage)' }}
              >
                {doseBadge}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {formatDate(vaccine.vaccine_date)}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
            {vaccine.manufacturer && (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {vaccine.manufacturer}
              </p>
            )}
            {vaccine.lot_number && (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Lot: {vaccine.lot_number}
              </p>
            )}
          </div>
          {vaccine.next_dose_date && (
            <p className="text-xs mt-1" style={{ color: 'var(--accent-purple)' }}>
              Next dose: {formatDate(vaccine.next_dose_date)}
            </p>
          )}
          {vaccine.notes && (
            <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
              {vaccine.notes}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-sage)' }}
          >
            Edit
          </button>
          {confirmDelete ? (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onDelete(vaccine.id)}
                className="px-2 py-1 rounded text-xs font-medium cursor-pointer"
                style={{ backgroundColor: 'var(--color-terracotta)', color: 'var(--color-bark)' }}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded text-xs font-medium cursor-pointer"
                style={{ color: 'var(--color-text-muted)' }}
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{
                backgroundColor: 'transparent',
                color: 'var(--color-terracotta)',
                border: '1px solid #F87171',
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
