'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { conditionSchema, type ConditionFormValues } from '@/lib/validations';
import { ProviderPicker } from '@/components/shared/ProviderPicker';
import { MedicalAutocomplete } from '@/components/shared/MedicalAutocomplete';
import { searchConditions } from '@/lib/medical-apis';

interface AddConditionFormProps {
  onSubmit: (data: ConditionFormValues & { provider_id: string | null; notes: string | null; icd10_code?: string | null }) => Promise<void>;
  onCancel?: () => void;
}

export default function AddConditionForm({ onSubmit, onCancel }: AddConditionFormProps) {
  const [providerId, setProviderId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [icd10Code, setIcd10Code] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ConditionFormValues>({
    resolver: zodResolver(conditionSchema),
    defaultValues: {
      name: '',
      status: 'active',
      diagnosed_date: '',
    },
  });

  const handleFormSubmit = async (data: ConditionFormValues) => {
    setSubmitting(true);
    try {
      await onSubmit({
        ...data,
        provider_id: providerId,
        notes: notes.trim() || null,
        icd10_code: icd10Code ?? undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
        Add Condition
      </h2>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        <MedicalAutocomplete
          label="Name"
          value={watch('name')}
          code={icd10Code}
          onChange={(val, code) => {
            setValue('name', val, { shouldValidate: true });
            setIcd10Code(code);
          }}
          searchFn={searchConditions}
          placeholder="Search conditions (e.g. Sleep Apnea)..."
          required
          error={errors.name?.message}
          id="condition-name"
        />

        <div>
          <label htmlFor="condition-status" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
            Status
          </label>
          <select
            id="condition-status"
            {...register('status')}
            className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
          >
            <option value="active">Active</option>
            <option value="resolved">Resolved</option>
            <option value="managed">Managed</option>
            <option value="monitoring">Monitoring</option>
          </select>
        </div>

        <div>
          <label htmlFor="condition-diagnosed-date" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
            Diagnosed Date
          </label>
          <input
            id="condition-diagnosed-date"
            type="date"
            {...register('diagnosed_date')}
            className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
            aria-invalid={errors.diagnosed_date ? 'true' : undefined}
            aria-describedby={errors.diagnosed_date ? 'condition-date-error' : undefined}
          />
          {errors.diagnosed_date && (
            <p id="condition-date-error" className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
              {errors.diagnosed_date.message}
            </p>
          )}
        </div>

        <ProviderPicker
          value={providerId}
          onChange={setProviderId}
          label="Provider"
        />

        <div>
          <label htmlFor="condition-notes" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
            Notes
          </label>
          <textarea
            id="condition-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Any additional notes..."
            className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none resize-none"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
          >
            {submitting ? 'Adding...' : 'Add Condition'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-2 rounded-lg border text-sm font-medium"
              style={{ border: '2px solid var(--color-soft-peach)', color: 'var(--color-bark)', backgroundColor: 'var(--color-cream)' }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
