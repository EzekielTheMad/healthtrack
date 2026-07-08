'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { appointmentSchema, type AppointmentFormValues } from '@/lib/validations';
import { ProviderPicker } from '@/components/shared/ProviderPicker';
import type { Appointment } from '@/lib/types';

const PROVIDER_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pcp: { label: 'Primary Care', color: 'var(--color-sage)', bg: 'rgba(74,222,128,0.15)' },
  specialist: { label: 'Specialist', color: 'var(--accent-purple)', bg: 'rgba(167, 139, 250, 0.12)' },
  lab: { label: 'Lab', color: 'var(--color-sage)', bg: 'rgba(96,165,250,0.15)' },
  imaging: { label: 'Imaging', color: 'var(--color-warning)', bg: 'rgba(251,191,36,0.15)' },
  urgent_care: { label: 'Urgent Care', color: 'var(--color-terracotta)', bg: 'rgba(224, 122, 95, 0.15)' },
  hospital: { label: 'Hospital', color: 'var(--color-terracotta)', bg: 'rgba(224, 122, 95, 0.15)' },
  pharmacy: { label: 'Pharmacy', color: 'var(--color-sage)', bg: 'rgba(96,165,250,0.15)' },
  therapist: { label: 'Therapist', color: 'var(--accent-purple)', bg: 'rgba(167, 139, 250, 0.12)' },
  dentist: { label: 'Dentist', color: 'var(--color-sage)', bg: 'rgba(74,222,128,0.15)' },
  other: { label: 'Other', color: 'var(--color-text-muted)', bg: 'rgba(139,149,176,0.15)' },
};

interface AppointmentCardProps {
  appointment: Appointment;
  onUpdate: (id: string, updates: Partial<Omit<Appointment, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => Promise<void>;
  providerName?: string;
  providerType?: string | null;
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AppointmentCard({ appointment, onUpdate, providerName, providerType }: AppointmentCardProps) {
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editProviderId, setEditProviderId] = useState<string | null>(appointment.provider_id);
  const [editNotes, setEditNotes] = useState(appointment.notes ?? '');
  const [editFollowUp, setEditFollowUp] = useState(appointment.follow_up_date ?? '');

  const isPast = new Date(appointment.appointment_date) < new Date();

  const typeInfo = providerType && PROVIDER_TYPE_LABELS[providerType]
    ? PROVIDER_TYPE_LABELS[providerType]
    : null;

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AppointmentFormValues>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      provider_id: appointment.provider_id ?? '',
      appointment_date: appointment.appointment_date
        ? new Date(appointment.appointment_date).toISOString().slice(0, 16)
        : '',
      reason: appointment.reason ?? '',
    },
  });

  const onSubmit = async (data: AppointmentFormValues) => {
    setSaving(true);
    try {
      await onUpdate(appointment.id, {
        provider_id: editProviderId,
        appointment_date: new Date(data.appointment_date).toISOString(),
        reason: data.reason ?? null,
        notes: editNotes.trim() || null,
        follow_up_date: editFollowUp || null,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div
        className="rounded-xl border p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <ProviderPicker
            value={editProviderId}
            onChange={(id) => {
              setEditProviderId(id);
              setValue('provider_id', id ?? '', { shouldValidate: true });
            }}
            label="Provider"
          />
          {errors.provider_id && (
            <p className="text-xs -mt-2" style={{ color: 'var(--color-terracotta)' }}>{errors.provider_id.message}</p>
          )}

          <div>
            <label htmlFor={`edit-date-${appointment.id}`} className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Date & Time
            </label>
            <input
              id={`edit-date-${appointment.id}`}
              type="datetime-local"
              {...register('appointment_date')}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
              aria-invalid={errors.appointment_date ? 'true' : undefined}
            />
            {errors.appointment_date && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>{errors.appointment_date.message}</p>
            )}
          </div>

          <div>
            <label htmlFor={`edit-reason-${appointment.id}`} className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Reason
            </label>
            <input
              id={`edit-reason-${appointment.id}`}
              type="text"
              {...register('reason')}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
            />
          </div>

          <div>
            <label htmlFor={`edit-notes-${appointment.id}`} className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Notes
            </label>
            <textarea
              id={`edit-notes-${appointment.id}`}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none resize-none"
              style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
            />
          </div>

          <div>
            <label htmlFor={`edit-followup-${appointment.id}`} className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Follow-up Date
            </label>
            <input
              id={`edit-followup-${appointment.id}`}
              type="date"
              value={editFollowUp}
              onChange={(e) => setEditFollowUp(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 py-2 rounded-lg border text-sm font-medium"
              style={{ border: '2px solid var(--color-soft-peach)', color: 'var(--color-bark)', backgroundColor: 'var(--color-cream)' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-base" style={{ color: 'var(--color-text-primary)' }}>
              {providerName ?? 'Unknown Provider'}
            </h3>
            {typeInfo && (
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ color: typeInfo.color, backgroundColor: typeInfo.bg }}
              >
                {typeInfo.label}
              </span>
            )}
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={
                isPast
                  ? { color: 'var(--color-text-muted)', backgroundColor: 'rgba(139,149,176,0.15)' }
                  : { color: 'var(--color-sage)', backgroundColor: 'rgba(74,222,128,0.15)' }
              }
            >
              {isPast ? 'Past' : 'Upcoming'}
            </span>
          </div>

          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {formatDateTime(appointment.appointment_date)}
          </p>

          {appointment.reason && (
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
              {appointment.reason}
            </p>
          )}

          {appointment.follow_up_date && (
            <p className="text-xs mt-2" style={{ color: 'var(--color-warning)' }}>
              Follow-up: {new Date(appointment.follow_up_date).toLocaleDateString()}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs px-3 py-1 rounded-lg border font-medium transition-colors shrink-0"
          style={{ borderColor: 'var(--border-card)', color: 'var(--color-sage)' }}
          aria-label={`Edit appointment with ${providerName ?? 'provider'}`}
        >
          Edit
        </button>
      </div>

      {appointment.notes && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setNotesExpanded(!notesExpanded)}
            className="text-xs font-medium flex items-center gap-1"
            style={{ color: 'var(--color-text-muted)' }}
            aria-expanded={notesExpanded}
            aria-controls={`appt-notes-${appointment.id}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-3 w-3 transition-transform ${notesExpanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Notes
          </button>
          {notesExpanded && (
            <p
              id={`appt-notes-${appointment.id}`}
              className="text-sm mt-1 whitespace-pre-wrap"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {appointment.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
