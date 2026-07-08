'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { delegateInviteSchema, type DelegateInviteFormValues } from '@/lib/validations';
import { useDelegates } from '@/hooks/useDelegates';
import type { Delegate, DelegatePermissionLevel } from '@/lib/types';
import EmptyState from '@/components/shared/EmptyState';
import Skeleton from '@/components/shared/Skeleton';

function PermissionBadge({ level }: { level: DelegatePermissionLevel }) {
  const styles: Record<DelegatePermissionLevel, { bg: string; color: string; label: string }> = {
    read_only: { bg: 'rgba(129, 178, 154, 0.15)', color: 'var(--color-sage)', label: 'Read Only' },
    read_write: { bg: 'rgba(167, 139, 250, 0.15)', color: 'var(--accent-purple)', label: 'Read & Write' },
    admin: { bg: 'rgba(251, 191, 36, 0.15)', color: 'var(--color-warning)', label: 'Admin' },
  };
  const s = styles[level];
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    pending: { bg: 'rgba(251, 191, 36, 0.15)', color: 'var(--color-warning)' },
    accepted: { bg: 'rgba(129, 178, 154, 0.15)', color: 'var(--color-sage)' },
    rejected: { bg: 'rgba(248, 113, 113, 0.15)', color: 'var(--color-terracotta)' },
  };
  const s = styles[status] ?? styles.pending;
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Invite Form
// ---------------------------------------------------------------------------

function InviteForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: DelegateInviteFormValues) => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DelegateInviteFormValues>({
    resolver: zodResolver(delegateInviteSchema),
    defaultValues: {
      delegate_email: '',
      permission_level: 'read_only',
    },
  });

  const inputStyle = {
    backgroundColor: 'var(--bg-primary)',
    borderColor: 'var(--border-card)',
    color: 'var(--color-text-primary)',
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-lg border p-4 mb-4 space-y-4"
      style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
    >
      {/* Email */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
          Person&apos;s Email
        </label>
        <input
          type="email"
          {...register('delegate_email')}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
          style={{ ...inputStyle, '--tw-ring-color': 'var(--color-sage)' } as React.CSSProperties}
          placeholder="family@example.com"
        />
        {errors.delegate_email && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
            {errors.delegate_email.message}
          </p>
        )}
      </div>

      {/* Permission Level */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
          Permission Level
        </label>
        <select
          {...register('permission_level')}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none cursor-pointer"
          style={inputStyle}
        >
          <option value="read_only">Read Only — View data, no changes</option>
          <option value="read_write">Read &amp; Write — View and add/update data</option>
          <option value="admin">Admin — Full access including uploads</option>
        </select>
        {errors.permission_level && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
            {errors.permission_level.message}
          </p>
        )}
      </div>

      {/* Optional Expiration */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
          Expiration Date <span style={{ color: 'var(--color-text-muted)' }}>(optional)</span>
        </label>
        <input
          type="date"
          {...register('expires_at')}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
          style={{ ...inputStyle, '--tw-ring-color': 'var(--color-sage)' } as React.CSSProperties}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))',
            color: 'white',
            boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)',
          }}
        >
          {isSubmitting ? 'Sending...' : 'Send Invitation'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--border-card)',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sent Delegate Row (people with access to my data)
// ---------------------------------------------------------------------------

function SentDelegateRow({
  delegate,
  onRevoke,
}: {
  delegate: Delegate;
  onRevoke: (id: string) => void;
}) {
  return (
    <div
      className="rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {delegate.delegate_email}
          </span>
          <PermissionBadge level={delegate.permission_level} />
          <StatusBadge status={delegate.status} />
        </div>
        {delegate.expires_at && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Expires: {new Date(delegate.expires_at).toLocaleDateString()}
          </p>
        )}
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Invited: {new Date(delegate.invited_at).toLocaleDateString()}
        </p>
      </div>
      <button
        onClick={() => onRevoke(delegate.id)}
        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer self-start sm:self-center"
        style={{
          backgroundColor: 'rgba(248, 113, 113, 0.1)',
          color: 'var(--color-terracotta)',
          border: '1px solid rgba(248, 113, 113, 0.3)',
        }}
      >
        Revoke
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Received Delegate Row (accounts I can access)
// ---------------------------------------------------------------------------

function ReceivedDelegateRow({
  delegate,
  onAccept,
  onReject,
}: {
  delegate: Delegate;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const ownerLabel = delegate.owner_display_name ?? `User (${delegate.owner_id.slice(0, 8)}...)`;

  return (
    <div
      className="rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            From: {ownerLabel}
          </span>
          <PermissionBadge level={delegate.permission_level} />
          <StatusBadge status={delegate.status} />
        </div>
        {delegate.expires_at && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Expires: {new Date(delegate.expires_at).toLocaleDateString()}
          </p>
        )}
        {delegate.accepted_at && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Accepted: {new Date(delegate.accepted_at).toLocaleDateString()}
          </p>
        )}
      </div>
      <div className="flex gap-2 self-start sm:self-center">
        {delegate.status === 'pending' ? (
          <>
            <button
              onClick={() => onAccept(delegate.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: 'rgba(74, 222, 128, 0.1)',
                color: 'var(--color-sage)',
                border: '1px solid rgba(74, 222, 128, 0.3)',
              }}
            >
              Accept
            </button>
            <button
              onClick={() => onReject(delegate.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: 'rgba(248, 113, 113, 0.1)',
                color: 'var(--color-terracotta)',
                border: '1px solid rgba(248, 113, 113, 0.3)',
              }}
            >
              Decline
            </button>
          </>
        ) : (
          <span
            className="text-xs px-2 py-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {delegate.status === 'accepted' ? 'Active' : 'Declined'}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

function DelegateListSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <Skeleton key={i} variant="card" className="h-[72px]" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DelegateManager() {
  const [tab, setTab] = useState<'sent' | 'received'>('sent');
  const [showForm, setShowForm] = useState(false);
  const {
    sentDelegates,
    receivedDelegates,
    loading,
    error,
    inviteDelegate,
    acceptDelegate,
    rejectDelegate,
    revokeDelegate,
  } = useDelegates();

  const handleInvite = async (data: DelegateInviteFormValues) => {
    const result = await inviteDelegate({
      delegate_email: data.delegate_email,
      permission_level: data.permission_level,
      expires_at: data.expires_at,
    });
    if (result) {
      setShowForm(false);
    }
  };

  const tabs = [
    { key: 'sent' as const, label: 'People with My Access', count: sentDelegates.length },
    { key: 'received' as const, label: 'Accounts I Can Access', count: receivedDelegates.length },
  ];

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: tab === t.key ? 'var(--bg-card)' : 'transparent',
              color: tab === t.key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-sage)' }}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(248, 113, 113, 0.1)',
            borderColor: 'rgba(248, 113, 113, 0.3)',
            color: 'var(--color-terracotta)',
          }}
        >
          {error}
        </div>
      )}

      {/* Sent tab — people with access to my data */}
      {tab === 'sent' && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Grant trusted adults access to view or manage your health data. Unlike dependents, these are accounts that belong to other adults.
          </p>

          {showForm ? (
            <InviteForm onSubmit={handleInvite} onCancel={() => setShowForm(false)} />
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer border border-dashed"
              style={{
                borderColor: 'var(--border-card)',
                color: 'var(--color-sage)',
                backgroundColor: 'transparent',
              }}
            >
              + Invite Someone
            </button>
          )}

          {loading ? (
            <DelegateListSkeleton />
          ) : sentDelegates.length === 0 ? (
            <EmptyState
              icon={
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }
              title="No delegates yet"
              description="Invite a trusted adult to help manage your health data."
              action={{ label: 'Invite Someone', onClick: () => setShowForm(true) }}
            />
          ) : (
            sentDelegates.map((d) => (
              <SentDelegateRow key={d.id} delegate={d} onRevoke={revokeDelegate} />
            ))
          )}
        </div>
      )}

      {/* Received tab — accounts I can access */}
      {tab === 'received' && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Health accounts that others have granted you access to. Accept pending invitations to start managing their data.
          </p>

          {loading ? (
            <DelegateListSkeleton />
          ) : receivedDelegates.length === 0 ? (
            <EmptyState
              icon={
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              }
              title="No invitations"
              description="When someone grants you delegate access, it will appear here."
            />
          ) : (
            receivedDelegates.map((d) => (
              <ReceivedDelegateRow
                key={d.id}
                delegate={d}
                onAccept={acceptDelegate}
                onReject={rejectDelegate}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
