'use client';

import { useState, useMemo } from 'react';
import { useAllergies } from '@/hooks/useAllergies';
import AllergyCard from '@/components/allergies/AllergyCard';
import AddAllergyForm, { type AddAllergyFormData } from '@/components/allergies/AddAllergyForm';
import EmptyState from '@/components/shared/EmptyState';
import Skeleton from '@/components/shared/Skeleton';
import type { AllergySeverity } from '@/lib/types';

const SEVERITY_FILTERS: { value: AllergySeverity | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'life_threatening', label: 'Life-Threatening' },
  { value: 'severe', label: 'Severe' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'mild', label: 'Mild' },
];

export default function AllergiesPage() {
  const { allergies, loading, error, addAllergy, updateAllergy, deleteAllergy } = useAllergies();
  const [showAddForm, setShowAddForm] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<AllergySeverity | 'all'>('all');

  const filtered = useMemo(() => {
    if (severityFilter === 'all') return allergies;
    return allergies.filter((a) => a.severity === severityFilter);
  }, [allergies, severityFilter]);

  const handleAdd = async (data: AddAllergyFormData) => {
    await addAllergy({
      name: data.name,
      severity: data.severity,
      reaction: data.reaction || null,
      diagnosed_date: data.diagnosed_date || null,
      notes: data.notes || null,
      rxcui: data.rxcui ?? null,
    });
    setShowAddForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Allergies</h1>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          {showAddForm ? 'Cancel' : 'Add Allergy'}
        </button>
      </div>

      {showAddForm && (
        <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>New Allergy</h2>
          <AddAllergyForm onSubmit={handleAdd} onCancel={() => setShowAddForm(false)} />
        </div>
      )}

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(224, 122, 95, 0.15)', color: 'var(--color-terracotta)' }}>
          {error}
        </div>
      )}

      <div className="flex gap-2 flex-wrap" role="tablist">
        {SEVERITY_FILTERS.map((f) => {
          const isActive = severityFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSeverityFilter(f.value)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              style={isActive
                ? { backgroundColor: 'var(--color-cream)', color: 'var(--color-text-primary)' }
                : { backgroundColor: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--border-card)' }
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}>
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            }
            title={severityFilter === 'all' ? 'No allergies recorded' : `No ${severityFilter} allergies`}
            description="Track your allergies to help AI provide safer medication and health recommendations."
            action={severityFilter === 'all' ? { label: 'Add Allergy', onClick: () => setShowAddForm(true) } : undefined}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((allergy) => (
            <AllergyCard key={allergy.id} allergy={allergy} onUpdate={updateAllergy} onDelete={deleteAllergy} />
          ))}
        </div>
      )}
    </div>
  );
}
