'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { dependentSchema, type DependentFormValues } from '@/lib/validations';
import { useDependents } from '@/hooks/useDependents';
import type { Dependent } from '@/lib/types';
import EmptyState from '@/components/shared/EmptyState';
import Skeleton from '@/components/shared/Skeleton';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RELATIONSHIP_COLORS: Record<string, { bg: string; text: string }> = {
  child: { bg: 'rgba(167, 139, 250, 0.15)', text: 'var(--accent-purple)' },
  spouse: { bg: 'rgba(96, 165, 250, 0.15)', text: 'var(--color-sage)' },
  parent: { bg: 'rgba(129, 178, 154, 0.15)', text: 'var(--color-sage)' },
  sibling: { bg: 'rgba(251, 191, 36, 0.15)', text: 'var(--color-warning)' },
  other: { bg: 'rgba(155, 155, 155, 0.15)', text: 'var(--color-text-muted)' },
};

const RELATIONSHIPS = [
  { value: 'child', label: 'Child' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'parent', label: 'Parent' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'other', label: 'Other' },
];

const SEX_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

// ---------------------------------------------------------------------------
// Shared input styles
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-primary)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--border-card)',
};

const labelStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
};

// ---------------------------------------------------------------------------
// Relationship badge
// ---------------------------------------------------------------------------

function RelationshipBadge({ relationship }: { relationship: string }) {
  const colors = RELATIONSHIP_COLORS[relationship] ?? RELATIONSHIP_COLORS.other;
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full font-medium capitalize"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {relationship}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Transition Dialog (modal)
// ---------------------------------------------------------------------------

function TransitionDialog({
  dependent,
  onClose,
}: {
  dependent: Dependent;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSend() {
    if (!email) return;
    setSending(true);
    setErr(null);

    try {
      const res = await fetch('/api/dependents/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependent_id: dependent.id, email }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to send invitation');
      }

      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to send invitation');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="w-full max-w-md rounded-xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Transition to Independent Account
        </h3>

        {sent ? (
          <div className="space-y-4">
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{
                backgroundColor: 'rgba(74, 222, 128, 0.1)',
                color: 'var(--color-sage)',
                border: '1px solid rgba(74, 222, 128, 0.2)',
              }}
            >
              Invitation sent! {dependent.name} can now create their account.
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                type="button"
                className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {dependent.name} will receive an email invitation to create their own HealthTracker
              account. Their existing health data will be shared with their new account so nothing
              is lost.
            </p>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={labelStyle}>
                {dependent.name}&apos;s Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
            </div>

            {err && (
              <div
                className="rounded-lg px-4 py-3 text-sm"
                style={{
                  backgroundColor: '#2D1215',
                  color: 'var(--color-terracotta)',
                  border: '1px solid #991B1B',
                }}
              >
                {err}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={onClose}
                disabled={sending}
                type="button"
                className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={!email || sending}
                type="button"
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--color-warning)', color: 'var(--color-bark)' }}
              >
                {sending ? 'Sending...' : 'Send Transition Invite'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete Confirmation Dialog
// ---------------------------------------------------------------------------

function DeleteConfirmDialog({
  dependent,
  onConfirm,
  onClose,
}: {
  dependent: Dependent;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="w-full max-w-sm rounded-xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--color-terracotta)' }}
      >
        <h3 className="text-lg font-semibold" style={{ color: 'var(--color-terracotta)' }}>
          Remove Dependent
        </h3>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Are you sure you want to remove <strong style={{ color: 'var(--color-text-primary)' }}>{dependent.name}</strong>?
          All health data associated with this dependent will be permanently deleted.
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            style={{ backgroundColor: 'rgba(127,29,29,0.5)', color: 'var(--color-terracotta)', border: '1px solid #991B1B' }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit Form
// ---------------------------------------------------------------------------

function DependentForm({
  defaultValues,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  defaultValues?: Partial<DependentFormValues>;
  onSubmit: (data: DependentFormValues) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<DependentFormValues>({
    resolver: zodResolver(dependentSchema),
    defaultValues: {
      name: '',
      date_of_birth: '',
      biological_sex: undefined,
      relationship: 'child',
      transition_age: 18,
      ...defaultValues,
    },
  });

  const relationship = watch('relationship');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={labelStyle}>
          Name
        </label>
        <input
          {...register('name')}
          type="text"
          placeholder="Full name"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={inputStyle}
        />
        {errors.name && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
            {errors.name.message}
          </p>
        )}
      </div>

      {/* Date of Birth */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={labelStyle}>
          Date of Birth
        </label>
        <input
          {...register('date_of_birth')}
          type="date"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={inputStyle}
        />
        {errors.date_of_birth && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
            {errors.date_of_birth.message}
          </p>
        )}
      </div>

      {/* Biological Sex */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={labelStyle}>
          Biological Sex
        </label>
        <select
          {...register('biological_sex')}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none appearance-none"
          style={inputStyle}
        >
          <option value="">Prefer not to say</option>
          {SEX_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Relationship */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={labelStyle}>
          Relationship
        </label>
        <select
          {...register('relationship')}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none appearance-none"
          style={inputStyle}
        >
          {RELATIONSHIPS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {errors.relationship && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
            {errors.relationship.message}
          </p>
        )}
      </div>

      {/* Transition Age (only for children) */}
      {relationship === 'child' && (
        <div>
          <label className="block text-xs font-medium mb-1.5" style={labelStyle}>
            Transition Age
          </label>
          <input
            {...register('transition_age', { valueAsNumber: true })}
            type="number"
            min={13}
            max={25}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Age when this dependent can transition to their own account (13-25).
          </p>
          {errors.transition_age && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
              {errors.transition_age.message}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={onCancel}
          disabled={isSubmitting}
          type="button"
          className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          {isSubmitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Dependent Card
// ---------------------------------------------------------------------------

function DependentCard({
  dependent,
  age,
  showTransition,
  onEdit,
  onDelete,
  onTransition,
}: {
  dependent: Dependent;
  age: number;
  showTransition: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTransition: () => void;
}) {
  const colors = RELATIONSHIP_COLORS[dependent.relationship] ?? RELATIONSHIP_COLORS.other;

  return (
    <div
      className="rounded-lg border p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ backgroundColor: colors.bg, color: colors.text }}
          >
            {dependent.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm" style={{ color: 'var(--color-text-primary)' }}>
                {dependent.name}
              </span>
              <RelationshipBadge relationship={dependent.relationship} />
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                DOB:{' '}
                <span className="font-mono" style={{ color: 'var(--color-text-primary)' }}>
                  {new Date(dependent.date_of_birth).toLocaleDateString()}
                </span>
              </span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Age:{' '}
                <span className="font-mono" style={{ color: 'var(--color-text-primary)' }}>
                  {age}
                </span>
              </span>
              {dependent.biological_sex && (
                <span className="text-xs capitalize" style={{ color: 'var(--color-text-muted)' }}>
                  {dependent.biological_sex}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Edit button */}
          <button
            onClick={onEdit}
            type="button"
            className="p-2 rounded-lg cursor-pointer transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            title="Edit"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M11.5 2.5L13.5 4.5M2 14L2.5 11.5L11 3L13 5L4.5 13.5L2 14Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {/* Delete button */}
          <button
            onClick={onDelete}
            type="button"
            className="p-2 rounded-lg cursor-pointer transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            title="Remove"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 4H13M5 4V3C5 2.448 5.448 2 6 2H10C10.552 2 11 2.448 11 3V4M6 7V11M10 7V11M4 4L4.5 13C4.5 13.552 4.948 14 5.5 14H10.5C11.052 14 11.5 13.552 11.5 13L12 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Transition banner */}
      {showTransition && (
        <div
          className="rounded-lg px-4 py-3 flex items-center justify-between gap-3"
          style={{
            backgroundColor: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid rgba(251, 191, 36, 0.2)',
          }}
        >
          <p className="text-xs" style={{ color: 'var(--color-warning)' }}>
            This dependent is {age}. Consider transitioning to an independent account.
          </p>
          <button
            onClick={onTransition}
            type="button"
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
            style={{ backgroundColor: 'rgba(251, 191, 36, 0.2)', color: 'var(--color-warning)' }}
          >
            Start Transition
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DependentManager (main export)
// ---------------------------------------------------------------------------

export default function DependentManager() {
  const {
    dependents,
    loading,
    error,
    addDependent,
    updateDependent,
    deleteDependent,
    getAge,
    needsTransition,
  } = useDependents();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingDep, setDeletingDep] = useState<Dependent | null>(null);
  const [transitionDep, setTransitionDep] = useState<Dependent | null>(null);

  async function handleAdd(data: DependentFormValues) {
    const created = await addDependent(data);
    if (created) {
      setShowAddForm(false);
    }
  }

  async function handleUpdate(id: string, data: DependentFormValues) {
    await updateDependent(id, data);
    setEditingId(null);
  }

  async function handleDelete() {
    if (!deletingDep) return;
    await deleteDependent(deletingDep.id);
    setDeletingDep(null);
  }

  // Loading state
  if (loading) {
    return (
      <div className="space-y-3" id="dependents">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }

  return (
    <div className="space-y-4" id="dependents">
      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{
            backgroundColor: '#2D1215',
            color: 'var(--color-terracotta)',
            border: '1px solid #991B1B',
          }}
        >
          {error}
        </div>
      )}

      {/* Dependent list */}
      {dependents.length === 0 && !showAddForm && (
        <EmptyState
          icon={
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="18" cy="16" r="6" stroke="currentColor" strokeWidth="2" />
              <path d="M6 40c0-6.627 5.373-10 12-10s12 3.373 12 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="36" cy="16" r="4" stroke="currentColor" strokeWidth="2" />
              <path d="M38 26c4 1 8 3.5 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
          title="No Dependents"
          description="No dependents added. Add a family member to track their health data."
          action={{
            label: 'Add Dependent',
            onClick: () => setShowAddForm(true),
          }}
        />
      )}

      {dependents.length > 0 && (
        <div className="space-y-3">
          {dependents.map((dep) => {
            const age = getAge(dep);

            if (editingId === dep.id) {
              return (
                <div
                  key={dep.id}
                  className="rounded-lg border p-4"
                  style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
                >
                  <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-primary)' }}>
                    Edit Dependent
                  </h4>
                  <DependentForm
                    defaultValues={{
                      name: dep.name,
                      date_of_birth: dep.date_of_birth,
                      biological_sex: dep.biological_sex as 'male' | 'female' | undefined,
                      relationship: dep.relationship,
                      transition_age: dep.transition_age,
                    }}
                    onSubmit={(data) => handleUpdate(dep.id, data)}
                    onCancel={() => setEditingId(null)}
                    submitLabel="Save Changes"
                  />
                </div>
              );
            }

            return (
              <DependentCard
                key={dep.id}
                dependent={dep}
                age={age}
                showTransition={needsTransition(dep)}
                onEdit={() => setEditingId(dep.id)}
                onDelete={() => setDeletingDep(dep)}
                onTransition={() => setTransitionDep(dep)}
              />
            );
          })}
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div
          className="rounded-lg border p-4"
          style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
        >
          <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-primary)' }}>
            Add Dependent
          </h4>
          <DependentForm
            onSubmit={handleAdd}
            onCancel={() => setShowAddForm(false)}
            submitLabel="Add Dependent"
          />
        </div>
      )}

      {/* Add button (when list is not empty and form is not shown) */}
      {dependents.length > 0 && !showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          type="button"
          className="w-full py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          style={{
            border: '1px dashed #1E2642',
            color: 'var(--color-sage)',
            backgroundColor: 'transparent',
          }}
        >
          + Add Dependent
        </button>
      )}

      {/* Delete confirmation dialog */}
      {deletingDep && (
        <DeleteConfirmDialog
          dependent={deletingDep}
          onConfirm={handleDelete}
          onClose={() => setDeletingDep(null)}
        />
      )}

      {/* Transition dialog */}
      {transitionDep && (
        <TransitionDialog
          dependent={transitionDep}
          onClose={() => setTransitionDep(null)}
        />
      )}
    </div>
  );
}
