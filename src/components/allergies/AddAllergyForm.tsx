'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { allergySchema, type AllergyFormValues } from '@/lib/validations';
import { MedicalAutocomplete } from '@/components/shared/MedicalAutocomplete';
import { searchRxNorm } from '@/lib/medical-apis';

const SEVERITY_OPTIONS = [
  { value: 'mild', label: 'Mild', color: 'var(--color-sage)' },
  { value: 'moderate', label: 'Moderate', color: 'var(--color-warning)' },
  { value: 'severe', label: 'Severe', color: '#F97316' },
  { value: 'life_threatening', label: 'Life-Threatening', color: 'var(--color-terracotta)' },
] as const;

export interface AddAllergyFormData {
  name: string;
  severity: 'mild' | 'moderate' | 'severe' | 'life_threatening';
  reaction?: string;
  diagnosed_date?: string;
  notes?: string;
  rxcui?: string | null;
}

interface AddAllergyFormProps {
  onSubmit: (data: AddAllergyFormData) => Promise<void>;
  onCancel?: () => void;
  initialValues?: Partial<AddAllergyFormData>;
  submitLabel?: string;
}

export default function AddAllergyForm({
  onSubmit,
  onCancel,
  initialValues,
  submitLabel = 'Add Allergy',
}: AddAllergyFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [rxcui, setRxcui] = useState<string | null>(initialValues?.rxcui ?? null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<AllergyFormValues>({
    resolver: zodResolver(allergySchema),
    defaultValues: {
      name: initialValues?.name ?? '',
      severity: initialValues?.severity ?? 'moderate',
      reaction: initialValues?.reaction ?? '',
      diagnosed_date: initialValues?.diagnosed_date ?? '',
      notes: initialValues?.notes ?? '',
    },
  });

  const inputStyle = { backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' };
  const labelStyle = { color: 'var(--color-text-primary)' };

  const handleFormSubmit = async (data: AllergyFormValues) => {
    setSubmitting(true);
    try {
      await onSubmit({ ...data, rxcui });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
      <MedicalAutocomplete
        label="Allergen"
        value={watch('name')}
        code={rxcui}
        onChange={(val, code) => {
          setValue('name', val, { shouldValidate: true });
          setRxcui(code);
        }}
        searchFn={searchRxNorm}
        placeholder="Search drug or allergen name..."
        required
        error={errors.name?.message}
        id="allergy-name"
      />

      <div>
        <label htmlFor="allergy-severity" className="block text-sm font-medium mb-1" style={labelStyle}>
          Severity <span style={{ color: 'var(--color-terracotta)' }}>*</span>
        </label>
        <select
          id="allergy-severity"
          {...register('severity')}
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
        >
          {SEVERITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {errors.severity && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>{errors.severity.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="allergy-reaction" className="block text-sm font-medium mb-1" style={labelStyle}>
          Reaction
        </label>
        <input
          id="allergy-reaction"
          type="text"
          {...register('reaction')}
          placeholder="e.g. Hives, anaphylaxis"
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
        />
      </div>

      <div>
        <label htmlFor="allergy-date" className="block text-sm font-medium mb-1" style={labelStyle}>
          Diagnosed Date
        </label>
        <input
          id="allergy-date"
          type="date"
          {...register('diagnosed_date')}
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
        />
      </div>

      <div>
        <label htmlFor="allergy-notes" className="block text-sm font-medium mb-1" style={labelStyle}>
          Notes
        </label>
        <textarea
          id="allergy-notes"
          {...register('notes')}
          rows={2}
          placeholder="Additional notes..."
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none resize-none"
          style={inputStyle}
        />
      </div>

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
