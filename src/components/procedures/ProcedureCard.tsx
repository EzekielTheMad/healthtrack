'use client';

import { useState } from 'react';
import type { Procedure } from '@/lib/types';
import AddProcedureForm, { type AddProcedureFormData } from './AddProcedureForm';

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ProcedureCardProps {
  procedure: Procedure;
  onUpdate: (id: string, updates: Partial<Procedure>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export default function ProcedureCard({ procedure, onUpdate, onDelete }: ProcedureCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleUpdate = async (data: AddProcedureFormData) => {
    await onUpdate(procedure.id, {
      name: data.name,
      procedure_date: data.procedure_date,
      provider_id: data.provider_id ?? null,
      notes: data.notes || null,
      cpt_code: data.cpt_code ?? null,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}>
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Edit Procedure</h3>
        <AddProcedureForm
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
          submitLabel="Save Changes"
          initialValues={{
            name: procedure.name,
            procedure_date: procedure.procedure_date,
            provider_id: procedure.provider_id,
            notes: procedure.notes ?? '',
            cpt_code: procedure.cpt_code,
          }}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-5" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {procedure.name}
            </h3>
            {procedure.cpt_code && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-cream)', color: 'var(--accent-purple)' }}>
                CPT: {procedure.cpt_code}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{formatDate(procedure.procedure_date)}</p>
          {procedure.provider_id && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>Provider on file</p>
          )}
          {procedure.notes && (
            <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>{procedure.notes}</p>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-sage)' }}
          >
            Edit
          </button>
          {confirmDelete ? (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onDelete(procedure.id)}
                className="px-2 py-1 rounded text-xs font-medium cursor-pointer"
                style={{ backgroundColor: 'var(--color-terracotta)', color: 'var(--color-bark)' }}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded text-xs font-medium cursor-pointer"
                style={{ color: 'var(--color-text-muted)' }}
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{ backgroundColor: 'transparent', color: 'var(--color-terracotta)', border: '1px solid #F87171' }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
