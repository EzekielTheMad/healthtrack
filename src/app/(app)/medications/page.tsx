'use client';

import { useState } from 'react';
import { useMedications } from '@/hooks/useMedications';
import { useInteractionAlerts } from '@/hooks/useInteractionAlerts';
import EmptyState from '@/components/shared/EmptyState';
import Skeleton from '@/components/shared/Skeleton';
import MedCard from '@/components/medications/MedCard';
import AddMedForm, { type AddMedFormData } from '@/components/medications/AddMedForm';
import InteractionAlert from '@/components/medications/InteractionAlert';

export default function MedicationsPage() {
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const [showAddForm, setShowAddForm] = useState(false);
  const { medications, loading, error, addMedication, updateMedication } = useMedications();
  const {
    alerts: interactionAlerts,
    dismissAlert,
    checkInteractions,
  } = useInteractionAlerts();

  const activeMeds = medications.filter((m) => m.active);
  const pastMeds = medications.filter((m) => !m.active);
  const displayedMeds = tab === 'active' ? activeMeds : pastMeds;

  const handleAdd = async (data: AddMedFormData) => {
    const isActive = data.active !== undefined ? data.active : true;
    const newMed = await addMedication({
      name: data.name,
      dosage: data.dosage ?? null,
      frequency: data.frequency,
      category: data.category ?? null,
      prescriber_id: data.prescriber_id,
      start_date: data.start_date,
      end_date: data.end_date ?? null,
      active: isActive,
      notes: data.notes ?? null,
      rxcui: data.rxcui ?? null,
    });
    setShowAddForm(false);
    if (newMed?.id && isActive) {
      checkInteractions(newMed.id);
    }
  };

  const handleUpdate = async (id: string, data: AddMedFormData) => {
    const wasActive = medications.find((m) => m.id === id)?.active;
    const nowActive = data.active ?? wasActive;

    await updateMedication(id, {
      name: data.name,
      dosage: data.dosage ?? null,
      frequency: data.frequency,
      category: data.category ?? null,
      prescriber_id: data.prescriber_id,
      start_date: data.start_date,
      end_date: data.end_date ?? null,
      notes: data.notes ?? null,
      rxcui: data.rxcui ?? null,
      ...(data.active !== undefined
        ? { active: data.active }
        : {}),
    });

    // Re-check interactions when medication status changes
    if (!wasActive && nowActive) {
      // Reactivated — check with the new med included
      checkInteractions(id);
    } else if (wasActive && !nowActive) {
      // Deactivated — re-check so stale alerts referencing this med are cleared
      checkInteractions();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Medications
        </h1>
        {!showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
          >
            Add Medication
          </button>
        )}
      </div>

      {/* Interaction alerts */}
      {interactionAlerts.length > 0 && (
        <div className="space-y-3">
          {interactionAlerts.map((alert) => (
            <InteractionAlert
              key={alert.id}
              alert={alert}
              onDismiss={dismissAlert}
            />
          ))}
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div
          className="rounded-xl border p-5"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
            New Medication
          </h2>
          <AddMedForm
            onSubmit={handleAdd}
            existingMeds={medications}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {/* Active / Past toggle */}
      <div className="flex gap-2" role="tablist" aria-label="Medication status filter">
        {(['active', 'past'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            role="tab"
            aria-selected={tab === t}
            aria-controls="medications-list"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize cursor-pointer"
            style={{
              backgroundColor: tab === t ? 'var(--color-sage)' : 'var(--bg-card)',
              color: tab === t ? 'var(--bg-primary)' : 'var(--color-text-muted)',
              border: tab === t ? 'none' : '1px solid #1E2642',
            }}
          >
            {t} ({t === 'active' ? activeMeds.length : pastMeds.length})
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-xl border p-4 text-sm"
          style={{ borderColor: 'var(--color-terracotta)', color: 'var(--color-terracotta)', backgroundColor: 'rgba(224, 122, 95, 0.05)' }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading medications">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      )}

      {/* Medication list */}
      {!loading && (
        <div id="medications-list" role="tabpanel" className="space-y-4">
          {displayedMeds.length === 0 ? (
            <div
              className="rounded-xl border"
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
            >
              <EmptyState
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-10 w-10"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a2.25 2.25 0 01-1.591.659H9.061a2.25 2.25 0 01-1.591-.659L5 14.5m14 0V5.846a2.25 2.25 0 00-1.683-2.177M5 14.5V5.846a2.25 2.25 0 011.683-2.177"
                    />
                  </svg>
                }
                title={
                  tab === 'active'
                    ? 'No active medications'
                    : 'No past medications'
                }
                description={
                  tab === 'active'
                    ? 'Add your current medications to track dosages, interactions, and refills.'
                    : 'Past medications will appear here when you mark them as inactive.'
                }
                action={
                  tab === 'active'
                    ? {
                        label: 'Add Medication',
                        onClick: () => setShowAddForm(true),
                      }
                    : undefined
                }
              />
            </div>
          ) : (
            displayedMeds.map((med) => (
              <MedCard
                key={med.id}
                medication={med}
                onUpdate={handleUpdate}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
