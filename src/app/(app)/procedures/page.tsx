'use client';

import { useState } from 'react';
import { useProcedures } from '@/hooks/useProcedures';
import ProcedureCard from '@/components/procedures/ProcedureCard';
import AddProcedureForm, { type AddProcedureFormData } from '@/components/procedures/AddProcedureForm';
import EmptyState from '@/components/shared/EmptyState';
import Skeleton from '@/components/shared/Skeleton';

export default function ProceduresPage() {
  const { procedures, loading, error, addProcedure, updateProcedure, deleteProcedure } = useProcedures();
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAdd = async (data: AddProcedureFormData) => {
    await addProcedure({
      name: data.name,
      procedure_date: data.procedure_date,
      provider_id: data.provider_id ?? null,
      notes: data.notes || null,
      cpt_code: data.cpt_code ?? null,
    });
    setShowAddForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>Procedures & Surgeries</h1>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          {showAddForm ? 'Cancel' : 'Add Procedure'}
        </button>
      </div>

      {showAddForm && (
        <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>New Procedure</h2>
          <AddProcedureForm onSubmit={handleAdd} onCancel={() => setShowAddForm(false)} />
        </div>
      )}

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(224, 122, 95, 0.15)', color: 'var(--color-terracotta)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : procedures.length === 0 ? (
        <div className="rounded-xl border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}>
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.4 48.4 0 01-4.163-.3c.186 1.613.849 3.085 1.86 4.27a8.877 8.877 0 006.643 3.13h.016a.403.403 0 00.317-.612 5.994 5.994 0 01-.938-3.209c0-2.764 1.871-5.088 4.415-5.785a.403.403 0 00-.09-.79 48.2 48.2 0 01-4.393.393.64.64 0 01-.657-.643v0z" />
              </svg>
            }
            title="No procedures recorded"
            description="Track past surgeries and procedures to give AI a complete picture of your medical history."
            action={{ label: 'Add Procedure', onClick: () => setShowAddForm(true) }}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {procedures.map((proc) => (
            <ProcedureCard key={proc.id} procedure={proc} onUpdate={updateProcedure} onDelete={deleteProcedure} />
          ))}
        </div>
      )}
    </div>
  );
}
