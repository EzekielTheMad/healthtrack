'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { procedureSchema, type ProcedureFormValues } from '@/lib/validations';
import { ProviderPicker } from '@/components/shared/ProviderPicker';
import { MedicalAutocomplete } from '@/components/shared/MedicalAutocomplete';
import { searchProcedures } from '@/lib/medical-apis';

export interface AddProcedureFormData {
  name: string;
  procedure_date: string;
  notes?: string;
  cpt_code?: string | null;
  provider_id?: string | null;
}

interface AddProcedureFormProps {
  onSubmit: (data: AddProcedureFormData) => Promise<void>;
  onCancel?: () => void;
  initialValues?: Partial<AddProcedureFormData>;
  submitLabel?: string;
}

export default function AddProcedureForm({
  onSubmit,
  onCancel,
  initialValues,
  submitLabel = 'Add Procedure',
}: AddProcedureFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [cptCode, setCptCode] = useState<string | null>(initialValues?.cpt_code ?? null);
  const [providerId, setProviderId] = useState<string | null>(initialValues?.provider_id ?? null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProcedureFormValues>({
    resolver: zodResolver(procedureSchema),
    defaultValues: {
      name: initialValues?.name ?? '',
      procedure_date: initialValues?.procedure_date ?? '',
      notes: initialValues?.notes ?? '',
    },
  });

  const inputStyle = { backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' };
  const labelStyle = { color: 'var(--color-text-primary)' };

  const handleFormSubmit = async (data: ProcedureFormValues) => {
    setSubmitting(true);
    try {
      await onSubmit({ ...data, cpt_code: cptCode, provider_id: providerId });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
      <MedicalAutocomplete
        label="Procedure Name"
        value={watch('name')}
        code={cptCode}
        onChange={(val, code) => {
          setValue('name', val, { shouldValidate: true });
          setCptCode(code);
        }}
        searchFn={searchProcedures}
        placeholder="Search procedures (e.g. Cholecystectomy)..."
        required
        error={errors.name?.message}
        id="procedure-name"
      />

      <div>
        <label htmlFor="procedure-date" className="block text-sm font-medium mb-1" style={labelStyle}>
          Date <span style={{ color: 'var(--color-terracotta)' }}>*</span>
        </label>
        <input
          id="procedure-date"
          type="date"
          {...register('procedure_date')}
          className="w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none"
          style={inputStyle}
        />
        {errors.procedure_date && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>{errors.procedure_date.message}</p>
        )}
      </div>

      <ProviderPicker value={providerId} onChange={setProviderId} label="Provider" />

      <div>
        <label htmlFor="procedure-notes" className="block text-sm font-medium mb-1" style={labelStyle}>
          Notes
        </label>
        <textarea
          id="procedure-notes"
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
