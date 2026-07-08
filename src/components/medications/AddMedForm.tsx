'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { medicationSchema, type MedicationFormValues } from '@/lib/validations';
import { ProviderPicker } from '@/components/shared/ProviderPicker';
import { MedicalAutocomplete, type AutocompleteResult } from '@/components/shared/MedicalAutocomplete';
import { searchRxNorm } from '@/lib/medical-apis';
import type { Medication, MedicationFrequency } from '@/lib/types';

const FREQUENCY_OPTIONS: { value: MedicationFrequency; label: string }[] = [
  { value: 'once_daily', label: 'Once Daily' },
  { value: 'twice_daily', label: 'Twice Daily' },
  { value: 'three_times_daily', label: 'Three Times Daily' },
  { value: 'four_times_daily', label: 'Four Times Daily' },
  { value: 'every_other_day', label: 'Every Other Day' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'as_needed', label: 'As Needed' },
  { value: 'other', label: 'Other' },
];

export interface AddMedFormData {
  name: string;
  dosage?: string;
  frequency: MedicationFrequency;
  category?: string;
  prescriber_id: string | null;
  start_date: string;
  end_date?: string;
  notes?: string;
  active?: boolean;
  rxcui?: string;
}

interface AddMedFormProps {
  onSubmit: (data: AddMedFormData) => Promise<void>;
  existingMeds?: Medication[];
  onCancel?: () => void;
  /** When provided, pre-fills form for editing */
  initialValues?: Partial<AddMedFormData>;
  submitLabel?: string;
  /** Show active/inactive toggle (only in edit mode) */
  showActiveToggle?: boolean;
}

export default function AddMedForm({
  onSubmit,
  existingMeds = [],
  onCancel,
  initialValues,
  submitLabel = 'Add Medication',
  showActiveToggle = false,
}: AddMedFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [prescriberId, setPrescriberId] = useState<string | null>(
    initialValues?.prescriber_id ?? null,
  );
  const [category, setCategory] = useState(initialValues?.category ?? '');
  const [notes, setNotes] = useState(initialValues?.notes ?? '');
  const [active, setActive] = useState(initialValues?.active ?? true);
  const [rxcui, setRxcui] = useState<string | null>(null);
  const [availableStrengths, setAvailableStrengths] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<MedicationFormValues>({
    resolver: zodResolver(medicationSchema),
    defaultValues: {
      name: initialValues?.name ?? '',
      dosage: initialValues?.dosage ?? '',
      frequency: initialValues?.frequency ?? 'once_daily',
      start_date: initialValues?.start_date ?? new Date().toISOString().slice(0, 10),
      end_date: initialValues?.end_date ?? '',
    },
  });

  const nameValue = watch('name');

  const duplicateWarning =
    nameValue.trim().length > 0 &&
    existingMeds.some(
      (m) =>
        m.active &&
        m.name.toLowerCase() === nameValue.trim().toLowerCase(),
    );

  const onFormSubmit = async (values: MedicationFormValues) => {
    setSubmitting(true);
    const hasEndDate = !!values.end_date?.trim();
    try {
      await onSubmit({
        name: values.name,
        dosage: values.dosage,
        frequency: values.frequency,
        category: category.trim() || undefined,
        prescriber_id: prescriberId,
        start_date: values.start_date,
        end_date: hasEndDate ? values.end_date : undefined,
        notes: notes.trim() || undefined,
        rxcui: rxcui ?? undefined,
        // If an end date is provided, default to inactive;
        // otherwise respect the active toggle (edit mode) or omit (add mode)
        ...(hasEndDate
          ? { active: false }
          : showActiveToggle
            ? { active }
            : {}),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = {
    backgroundColor: 'var(--bg-primary)',
    borderColor: 'var(--border-card)',
    color: 'var(--color-text-primary)',
  };

  const labelStyle = { color: 'var(--color-text-primary)' };
  const errorStyle = { color: 'var(--color-terracotta)' };

  return (
    <form
      onSubmit={handleSubmit(onFormSubmit)}
      className="space-y-4"
      aria-label="Medication form"
      noValidate
    >
      {/* Name with RxNorm autocomplete */}
      <MedicalAutocomplete
        label="Name"
        value={nameValue}
        code={rxcui}
        onChange={(val, code, result?: AutocompleteResult) => {
          setValue('name', val, { shouldValidate: true });
          setRxcui(code);
          if (result) {
            // Selection from dropdown — set strengths and clear dosage
            const strengths = (result as { strengths?: string[] }).strengths;
            setAvailableStrengths(strengths ?? []);
            setValue('dosage', '', { shouldValidate: false });
          } else {
            // Manual typing — clear strengths
            setAvailableStrengths([]);
          }
        }}
        searchFn={searchRxNorm}
        placeholder="Search medications..."
        required
        error={errors.name?.message}
        id="med-name"
      />
      {duplicateWarning && (
        <p className="text-xs -mt-2" style={{ color: 'var(--color-warning)' }}>
          A medication with this name already exists in your active list.
        </p>
      )}

      {/* Dosage */}
      <div>
        <label htmlFor="med-dosage" className="block text-sm font-medium mb-1" style={labelStyle}>
          Dosage
        </label>
        <input
          id="med-dosage"
          type="text"
          {...register('dosage')}
          placeholder="e.g. 10mg"
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
          aria-invalid={!!errors.dosage}
          aria-describedby={errors.dosage ? 'med-dosage-error' : undefined}
        />
        {errors.dosage && (
          <p id="med-dosage-error" className="text-xs mt-1" style={errorStyle}>
            {errors.dosage.message}
          </p>
        )}
        {availableStrengths.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {availableStrengths.map((strength) => (
              <button
                key={strength}
                type="button"
                onClick={() => {
                  const current = watch('dosage') ?? '';
                  if (current && !current.endsWith(' ')) {
                    setValue('dosage', `${current} + ${strength}`, { shouldValidate: true });
                  } else {
                    setValue('dosage', strength, { shouldValidate: true });
                  }
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                style={{
                  backgroundColor: 'var(--color-cream)',
                  color: 'var(--color-sage)',
                  border: '1px solid transparent',
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-sage)';
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
                }}
              >
                {strength}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Frequency */}
      <div>
        <label htmlFor="med-frequency" className="block text-sm font-medium mb-1" style={labelStyle}>
          Frequency <span style={{ color: 'var(--color-terracotta)' }}>*</span>
        </label>
        <select
          id="med-frequency"
          {...register('frequency')}
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
          aria-invalid={!!errors.frequency}
          aria-describedby={errors.frequency ? 'med-freq-error' : undefined}
        >
          {FREQUENCY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {errors.frequency && (
          <p id="med-freq-error" className="text-xs mt-1" style={errorStyle}>
            {errors.frequency.message}
          </p>
        )}
      </div>

      {/* Category */}
      <div>
        <label htmlFor="med-category" className="block text-sm font-medium mb-1" style={labelStyle}>
          Category
        </label>
        <input
          id="med-category"
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Blood Pressure, Antibiotic"
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
        />
      </div>

      {/* Prescriber */}
      <ProviderPicker
        value={prescriberId}
        onChange={setPrescriberId}
        label="Prescriber"
      />

      {/* Start Date */}
      <div>
        <label htmlFor="med-start-date" className="block text-sm font-medium mb-1" style={labelStyle}>
          Start Date <span style={{ color: 'var(--color-terracotta)' }}>*</span>
        </label>
        <input
          id="med-start-date"
          type="date"
          {...register('start_date')}
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
          aria-invalid={!!errors.start_date}
          aria-describedby={errors.start_date ? 'med-start-error' : undefined}
        />
        {errors.start_date && (
          <p id="med-start-error" className="text-xs mt-1" style={errorStyle}>
            {errors.start_date.message}
          </p>
        )}
      </div>

      {/* End Date (optional — sets medication as inactive) */}
      <div>
        <label htmlFor="med-end-date" className="block text-sm font-medium mb-1" style={labelStyle}>
          End Date <span className="text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>(leave blank if still taking)</span>
        </label>
        <input
          id="med-end-date"
          type="date"
          {...register('end_date')}
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
          aria-invalid={!!errors.end_date}
          aria-describedby={errors.end_date ? 'med-end-error' : undefined}
        />
        {errors.end_date && (
          <p id="med-end-error" className="text-xs mt-1" style={errorStyle}>
            {errors.end_date.message}
          </p>
        )}
      </div>

      {/* Active toggle (edit mode only) */}
      {showActiveToggle && (
        <div className="flex items-center justify-between py-2">
          <label htmlFor="med-active" className="text-sm font-medium" style={labelStyle}>
            Status
          </label>
          <button
            id="med-active"
            type="button"
            role="switch"
            aria-checked={active}
            onClick={() => setActive(!active)}
            className="relative inline-flex h-7 w-12 items-center rounded-full transition-colors"
            style={{ backgroundColor: active ? 'var(--color-sage)' : 'var(--border-card)' }}
          >
            <span
              className="inline-block h-5 w-5 rounded-full transition-transform"
              style={{
                backgroundColor: active ? 'var(--bg-primary)' : 'var(--color-text-muted)',
                transform: active ? 'translateX(24px)' : 'translateX(4px)',
              }}
            />
          </button>
          <span className="text-sm ml-2" style={{ color: active ? 'var(--color-sage)' : 'var(--color-text-muted)' }}>
            {active ? 'Active' : 'Inactive'}
          </span>
        </div>
      )}

      {/* Notes */}
      <div>
        <label htmlFor="med-notes" className="block text-sm font-medium mb-1" style={labelStyle}>
          Notes
        </label>
        <textarea
          id="med-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Additional notes..."
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none resize-none"
          style={inputStyle}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          {submitting ? 'Saving...' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            style={{ backgroundColor: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--border-card)' }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
