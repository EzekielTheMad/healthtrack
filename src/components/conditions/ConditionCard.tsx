'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { conditionSchema, type ConditionFormValues } from '@/lib/validations';
import { ProviderPicker } from '@/components/shared/ProviderPicker';
import type { Condition, ConditionStatus } from '@/lib/types';

const STATUS_CONFIG: Record<ConditionStatus, { label: string; color: string; bg: string }> = {
  active: { label: 'Active', color: 'var(--color-sage)', bg: 'rgba(74,222,128,0.15)' },
  resolved: { label: 'Resolved', color: 'var(--color-text-muted)', bg: 'rgba(139,149,176,0.15)' },
  managed: { label: 'Managed', color: 'var(--color-sage)', bg: 'rgba(96,165,250,0.15)' },
  monitoring: { label: 'Monitoring', color: 'var(--color-warning)', bg: 'rgba(251,191,36,0.15)' },
};

interface ConditionCardProps {
  condition: Condition;
  onUpdate: (id: string, updates: Partial<Omit<Condition, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => Promise<void>;
}

export default function ConditionCard({ condition, onUpdate }: ConditionCardProps) {
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editProviderId, setEditProviderId] = useState<string | null>(condition.provider_id);
  const [editNotes, setEditNotes] = useState(condition.notes ?? '');

  const statusInfo = STATUS_CONFIG[condition.status];

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ConditionFormValues>({
    resolver: zodResolver(conditionSchema),
    defaultValues: {
      name: condition.name,
      status: condition.status,
      diagnosed_date: condition.diagnosed_date ?? '',
    },
  });

  const handleStatusChange = async (newStatus: ConditionStatus) => {
    setSaving(true);
    try {
      await onUpdate(condition.id, { status: newStatus });
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = async (data: ConditionFormValues) => {
    setSaving(true);
    try {
      await onUpdate(condition.id, {
        name: data.name,
        status: data.status,
        diagnosed_date: data.diagnosed_date || null,
        provider_id: editProviderId,
        notes: editNotes.trim() || null,
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
          <div>
            <label htmlFor={`edit-name-${condition.id}`} className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Name
            </label>
            <input
              id={`edit-name-${condition.id}`}
              type="text"
              {...register('name')}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
              aria-invalid={errors.name ? 'true' : undefined}
            />
            {errors.name && <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor={`edit-status-${condition.id}`} className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Status
            </label>
            <select
              id={`edit-status-${condition.id}`}
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
            <label htmlFor={`edit-date-${condition.id}`} className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Diagnosed Date
            </label>
            <input
              id={`edit-date-${condition.id}`}
              type="date"
              {...register('diagnosed_date')}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
              aria-invalid={errors.diagnosed_date ? 'true' : undefined}
            />
            {errors.diagnosed_date && <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>{errors.diagnosed_date.message}</p>}
          </div>

          <ProviderPicker
            value={editProviderId}
            onChange={setEditProviderId}
            label="Provider"
          />

          <div>
            <label htmlFor={`edit-notes-${condition.id}`} className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Notes
            </label>
            <textarea
              id={`edit-notes-${condition.id}`}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none resize-none"
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
              {condition.name}
            </h3>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ color: statusInfo.color, backgroundColor: statusInfo.bg }}
            >
              {statusInfo.label}
            </span>
          </div>

          {condition.diagnosed_date && (
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Diagnosed: {new Date(condition.diagnosed_date).toLocaleDateString()}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <label htmlFor={`status-change-${condition.id}`} className="sr-only">Change status</label>
            <select
              id={`status-change-${condition.id}`}
              value={condition.status}
              onChange={(e) => handleStatusChange(e.target.value as ConditionStatus)}
              disabled={saving}
              className="text-xs px-2 py-1 rounded-lg border appearance-none pr-6 focus:outline-none"
              style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)', color: 'var(--color-text-muted)' }}
              aria-label="Change condition status"
            >
              <option value="active">Active</option>
              <option value="resolved">Resolved</option>
              <option value="managed">Managed</option>
              <option value="monitoring">Monitoring</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs px-3 py-1 rounded-lg border font-medium transition-colors"
            style={{ borderColor: 'var(--border-card)', color: 'var(--color-sage)' }}
            aria-label={`Edit condition ${condition.name}`}
          >
            Edit
          </button>
        </div>
      </div>

      {condition.notes && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setNotesExpanded(!notesExpanded)}
            className="text-xs font-medium flex items-center gap-1"
            style={{ color: 'var(--color-text-muted)' }}
            aria-expanded={notesExpanded}
            aria-controls={`notes-${condition.id}`}
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
              id={`notes-${condition.id}`}
              className="text-sm mt-1 whitespace-pre-wrap"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {condition.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
