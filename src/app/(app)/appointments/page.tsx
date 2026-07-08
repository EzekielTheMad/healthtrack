'use client';

import { useState, useMemo } from 'react';
import { useAppointments } from '@/hooks/useAppointments';
import { useProviders } from '@/hooks/useProviders';
import AppointmentCard from '@/components/appointments/AppointmentCard';
import AddAppointmentForm from '@/components/appointments/AddAppointmentForm';
import EmptyState from '@/components/shared/EmptyState';
import Skeleton from '@/components/shared/Skeleton';
import type { AppointmentFormValues } from '@/lib/validations';

type TimeFilter = 'upcoming' | 'past' | 'all';

const TIME_FILTERS: { value: TimeFilter; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

export default function AppointmentsPage() {
  const { appointments, loading, error, addAppointment, updateAppointment } = useAppointments();
  const { providers } = useProviders();
  const [showAddForm, setShowAddForm] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('upcoming');

  const now = useMemo(() => new Date(), []);

  const filteredAppointments = useMemo(() => {
    let filtered = appointments;
    if (timeFilter === 'upcoming') {
      filtered = appointments.filter((a) => new Date(a.appointment_date) >= now);
    } else if (timeFilter === 'past') {
      filtered = appointments.filter((a) => new Date(a.appointment_date) < now);
    }
    // Sort chronologically: upcoming = ascending, past = descending, all = descending
    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.appointment_date).getTime();
      const dateB = new Date(b.appointment_date).getTime();
      return timeFilter === 'upcoming' ? dateA - dateB : dateB - dateA;
    });
  }, [appointments, timeFilter, now]);

  const getProviderInfo = (providerId: string | null) => {
    if (!providerId) return { name: undefined, type: undefined };
    const provider = providers.find((p) => p.id === providerId);
    return {
      name: provider?.name,
      type: provider?.provider_type,
    };
  };

  const handleAdd = async (data: AppointmentFormValues & { notes: string | null; follow_up_date: string | null }) => {
    await addAppointment({
      provider_id: data.provider_id || null,
      appointment_date: data.appointment_date,
      reason: data.reason ?? null,
      notes: data.notes,
      follow_up_date: data.follow_up_date,
      lab_visit_id: null,
    });
    setShowAddForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Appointments
        </h1>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          {showAddForm ? 'Cancel' : 'Add Appointment'}
        </button>
      </div>

      {showAddForm && (
        <AddAppointmentForm
          onSubmit={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(224, 122, 95, 0.15)', color: 'var(--color-terracotta)' }}>
          {error}
        </div>
      )}

      {/* Time filter tabs */}
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Filter appointments by time">
        {TIME_FILTERS.map((filter) => {
          const isActive = timeFilter === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setTimeFilter(filter.value)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={
                isActive
                  ? { backgroundColor: 'var(--color-cream)', color: 'var(--color-text-primary)' }
                  : { backgroundColor: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--border-card)' }
              }
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading appointments">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : filteredAppointments.length === 0 ? (
        <div
          className="rounded-xl border"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            }
            title={
              timeFilter === 'all'
                ? 'No appointments yet'
                : timeFilter === 'upcoming'
                  ? 'No upcoming appointments'
                  : 'No past appointments'
            }
            description={
              timeFilter === 'all'
                ? 'Keep track of your doctor visits, follow-ups, and upcoming appointments.'
                : timeFilter === 'upcoming'
                  ? 'You have no upcoming appointments scheduled.'
                  : 'You have no past appointment records.'
            }
            action={
              timeFilter !== 'past'
                ? {
                    label: 'Add Appointment',
                    onClick: () => setShowAddForm(true),
                  }
                : undefined
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAppointments.map((appointment) => {
            const { name, type } = getProviderInfo(appointment.provider_id);
            return (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                onUpdate={updateAppointment}
                providerName={name}
                providerType={type}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
