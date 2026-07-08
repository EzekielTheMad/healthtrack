'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { vaccineSchema, type VaccineFormValues } from '@/lib/validations';
import { ProviderPicker } from '@/components/shared/ProviderPicker';
import { MedicalAutocomplete } from '@/components/shared/MedicalAutocomplete';
import { searchVaccines } from '@/lib/medical-apis';

export interface AddVaccineFormData {
  name: string;
  cvx_code?: string | null;
  vaccine_date: string;
  dose_number?: number | null;
  series_doses?: number | null;
  manufacturer?: string;
  lot_number?: string;
  provider_id?: string | null;
  next_dose_date?: string;
  notes?: string;
}

interface AddVaccineFormProps {
  onSubmit: (data: AddVaccineFormData) => Promise<void>;
  onCancel?: () => void;
  initialValues?: Partial<AddVaccineFormData>;
  submitLabel?: string;
}

export default function AddVaccineForm({
  onSubmit,
  onCancel,
  initialValues,
  submitLabel = 'Add Vaccine',
}: AddVaccineFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [cvxCode, setCvxCode] = useState<string | null>(initialValues?.cvx_code ?? null);
  const [providerId, setProviderId] = useState<string | null>(initialValues?.provider_id ?? null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<VaccineFormValues>({
    resolver: zodResolver(vaccineSchema),
    defaultValues: {
      name: initialValues?.name ?? '',
      vaccine_date: initialValues?.vaccine_date ?? '',
      dose_number: initialValues?.dose_number?.toString() ?? '',
      series_doses: initialValues?.series_doses?.toString() ?? '',
      manufacturer: initialValues?.manufacturer ?? '',
      lot_number: initialValues?.lot_number ?? '',
      next_dose_date: initialValues?.next_dose_date ?? '',
      notes: initialValues?.notes ?? '',
    },
  });

  const inputStyle = {
    backgroundColor: 'var(--bg-primary)',
    borderColor: 'var(--border-card)',
    color: 'var(--color-text-primary)',
  };
  const labelStyle = { color: 'var(--color-text-primary)' };

  const handleFormSubmit = async (data: VaccineFormValues) => {
    setSubmitting(true);
    try {
      await onSubmit({
        name: data.name,
        cvx_code: cvxCode,
        vaccine_date: data.vaccine_date,
        dose_number: data.dose_number ? parseInt(data.dose_number, 10) : null,
        series_doses: data.series_doses ? parseInt(data.series_doses, 10) : null,
        manufacturer: data.manufacturer?.trim() || undefined,
        lot_number: data.lot_number?.trim() || undefined,
        provider_id: providerId,
        next_dose_date: data.next_dose_date?.trim() || undefined,
        notes: data.notes?.trim() || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
      {/* Vaccine Name with CVX autocomplete */}
      <MedicalAutocomplete
        label="Vaccine Name"
        value={watch('name')}
        code={cvxCode}
        onChange={(val, code) => {
          setValue('name', val, { shouldValidate: true });
          setCvxCode(code);
        }}
        searchFn={searchVaccines}
        placeholder="Search vaccines (e.g. COVID-19, MMR, Hepatitis B)..."
        required
        error={errors.name?.message}
        id="vaccine-name"
      />

      {/* Date */}
      <div>
        <label htmlFor="vaccine-date" className="block text-sm font-medium mb-1" style={labelStyle}>
          Date Administered <span style={{ color: 'var(--color-terracotta)' }}>*</span>
        </label>
        <input
          id="vaccine-date"
          type="date"
          {...register('vaccine_date')}
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
        />
        {errors.vaccine_date && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
            {errors.vaccine_date.message}
          </p>
        )}
      </div>

      {/* Dose Number & Series */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="vaccine-dose" className="block text-sm font-medium mb-1" style={labelStyle}>
            Dose #
          </label>
          <input
            id="vaccine-dose"
            type="number"
            min="1"
            max="20"
            {...register('dose_number')}
            placeholder="e.g. 2"
            className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
            style={inputStyle}
          />
          {errors.dose_number && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
              {errors.dose_number.message}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="vaccine-series" className="block text-sm font-medium mb-1" style={labelStyle}>
            of Series
          </label>
          <input
            id="vaccine-series"
            type="number"
            min="1"
            max="20"
            {...register('series_doses')}
            placeholder="e.g. 3"
            className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
            style={inputStyle}
          />
          {errors.series_doses && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
              {errors.series_doses.message}
            </p>
          )}
        </div>
      </div>

      {/* Manufacturer & Lot Number */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="vaccine-manufacturer" className="block text-sm font-medium mb-1" style={labelStyle}>
            Manufacturer
          </label>
          <input
            id="vaccine-manufacturer"
            type="text"
            {...register('manufacturer')}
            placeholder="e.g. Pfizer"
            className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="vaccine-lot" className="block text-sm font-medium mb-1" style={labelStyle}>
            Lot Number
          </label>
          <input
            id="vaccine-lot"
            type="text"
            {...register('lot_number')}
            placeholder="e.g. EL9269"
            className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
            style={inputStyle}
          />
        </div>
      </div>

      {/* Provider */}
      <ProviderPicker value={providerId} onChange={setProviderId} label="Administered By" />

      {/* Next Dose Date */}
      <div>
        <label htmlFor="vaccine-next-dose" className="block text-sm font-medium mb-1" style={labelStyle}>
          Next Dose Due{' '}
          <span className="text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>
            (optional)
          </span>
        </label>
        <input
          id="vaccine-next-dose"
          type="date"
          {...register('next_dose_date')}
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
        />
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="vaccine-notes" className="block text-sm font-medium mb-1" style={labelStyle}>
          Notes
        </label>
        <textarea
          id="vaccine-notes"
          {...register('notes')}
          rows={2}
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
          style={{
            background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))',
            color: 'white',
            boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)',
          }}
        >
          {submitting ? 'Saving...' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: 'transparent',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--border-card)',
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
