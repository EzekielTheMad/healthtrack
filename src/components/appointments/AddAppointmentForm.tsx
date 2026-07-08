'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { appointmentSchema, type AppointmentFormValues } from '@/lib/validations';
import { ProviderPicker } from '@/components/shared/ProviderPicker';

interface AddAppointmentFormProps {
  onSubmit: (data: AppointmentFormValues & { notes: string | null; follow_up_date: string | null }) => Promise<void>;
  onCancel?: () => void;
}

export default function AddAppointmentForm({ onSubmit, onCancel }: AddAppointmentFormProps) {
  const [notes, setNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<AppointmentFormValues>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      provider_id: '',
      appointment_date: '',
      reason: '',
    },
  });

  const handleFormSubmit = async (data: AppointmentFormValues) => {
    setSubmitting(true);
    try {
      await onSubmit({
        ...data,
        appointment_date: new Date(data.appointment_date).toISOString(),
        notes: notes.trim() || null,
        follow_up_date: followUpDate || null,
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
        Add Appointment
      </h2>

      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
        <div>
          <ProviderPicker
            value={watch('provider_id') || null}
            onChange={(id) => setValue('provider_id', id ?? '', { shouldValidate: true })}
            label="Provider *"
          />
          {errors.provider_id && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
              {errors.provider_id.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="appointment-date" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
            Date & Time <span style={{ color: 'var(--color-terracotta)' }}>*</span>
          </label>
          <input
            id="appointment-date"
            type="datetime-local"
            {...register('appointment_date')}
            className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
            aria-invalid={errors.appointment_date ? 'true' : undefined}
            aria-describedby={errors.appointment_date ? 'appointment-date-error' : undefined}
          />
          {errors.appointment_date && (
            <p id="appointment-date-error" className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
              {errors.appointment_date.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="appointment-reason" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
            Reason
          </label>
          <input
            id="appointment-reason"
            type="text"
            {...register('reason')}
            placeholder="e.g. Annual checkup"
            className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
          />
          {errors.reason && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
              {errors.reason.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="appointment-notes" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
            Notes
          </label>
          <textarea
            id="appointment-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Any additional notes..."
            className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none resize-none"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
          />
        </div>

        <div>
          <label htmlFor="appointment-followup" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
            Follow-up Date
          </label>
          <input
            id="appointment-followup"
            type="date"
            value={followUpDate}
            onChange={(e) => setFollowUpDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
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
            {submitting ? 'Adding...' : 'Add Appointment'}
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
