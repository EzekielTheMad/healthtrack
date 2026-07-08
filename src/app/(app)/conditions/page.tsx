'use client';

import { useState, useMemo } from 'react';
import { useConditions } from '@/hooks/useConditions';
import ConditionCard from '@/components/conditions/ConditionCard';
import AddConditionForm from '@/components/conditions/AddConditionForm';
import EmptyState from '@/components/shared/EmptyState';
import Skeleton from '@/components/shared/Skeleton';
import type { ConditionStatus } from '@/lib/types';
import type { ConditionFormValues } from '@/lib/validations';

const STATUS_FILTERS: { value: ConditionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'managed', label: 'Managed' },
  { value: 'monitoring', label: 'Monitoring' },
];

export default function ConditionsPage() {
  const { conditions, loading, error, addCondition, updateCondition } = useConditions();
  const [showAddForm, setShowAddForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ConditionStatus | 'all'>('all');

  const filteredConditions = useMemo(() => {
    if (statusFilter === 'all') return conditions;
    return conditions.filter((c) => c.status === statusFilter);
  }, [conditions, statusFilter]);

  const handleAdd = async (data: ConditionFormValues & { provider_id: string | null; notes: string | null; icd10_code?: string | null }) => {
    await addCondition({
      name: data.name,
      status: data.status,
      diagnosed_date: data.diagnosed_date || null,
      provider_id: data.provider_id,
      notes: data.notes,
      icd10_code: data.icd10_code ?? null,
    });
    setShowAddForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Conditions
        </h1>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          {showAddForm ? 'Cancel' : 'Add Condition'}
        </button>
      </div>

      {showAddForm && (
        <AddConditionForm
          onSubmit={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(224, 122, 95, 0.15)', color: 'var(--color-terracotta)' }}>
          {error}
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Filter conditions by status">
        {STATUS_FILTERS.map((filter) => {
          const isActive = statusFilter === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setStatusFilter(filter.value)}
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
        <div className="space-y-3" aria-busy="true" aria-label="Loading conditions">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : filteredConditions.length === 0 ? (
        <div
          className="rounded-xl border"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" />
              </svg>
            }
            title={statusFilter === 'all' ? 'No conditions tracked yet' : `No ${statusFilter} conditions`}
            description={
              statusFilter === 'all'
                ? 'Track your health conditions along with their status and related providers.'
                : `You have no conditions with status "${statusFilter}".`
            }
            action={
              statusFilter === 'all'
                ? {
                    label: 'Add Condition',
                    onClick: () => setShowAddForm(true),
                  }
                : undefined
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredConditions.map((condition) => (
            <ConditionCard
              key={condition.id}
              condition={condition}
              onUpdate={updateCondition}
            />
          ))}
        </div>
      )}
    </div>
  );
}
