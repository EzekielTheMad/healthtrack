'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  shareSchema,
  type ShareFormValues,
  type ShareableSection,
} from '@/lib/validations';
import { useHealthShares } from '@/hooks/useHealthShares';
import type { HealthShare } from '@/lib/types';
import EmptyState from '@/components/shared/EmptyState';
import Skeleton from '@/components/shared/Skeleton';

const ALL_SECTIONS: { key: ShareableSection; label: string }[] = [
  { key: 'medications', label: 'Medications' },
  { key: 'labs', label: 'Labs' },
  { key: 'vitals', label: 'Vitals' },
  { key: 'conditions', label: 'Conditions' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'notes', label: 'Notes' },
];

function SectionTag({ section }: { section: string }) {
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full mr-1 mb-1"
      style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-sage)' }}
    >
      {section}
    </span>
  );
}

function AccessBadge({ level }: { level: string }) {
  const isReadWrite = level === 'read_write';
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        backgroundColor: isReadWrite ? 'rgba(167, 139, 250, 0.15)' : 'rgba(129, 178, 154, 0.15)',
        color: isReadWrite ? 'var(--accent-purple)' : 'var(--color-sage)',
      }}
    >
      {isReadWrite ? 'Read & Write' : 'Read Only'}
    </span>
  );
}

function StatusBadge({ accepted, expiresAt }: { accepted: boolean; expiresAt?: string | null }) {
  const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;

  if (isExpired) {
    return (
      <span
        className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ backgroundColor: 'rgba(156, 163, 175, 0.15)', color: 'var(--color-text-muted)' }}
      >
        Expired
      </span>
    );
  }

  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        backgroundColor: accepted ? 'rgba(129, 178, 154, 0.15)' : 'rgba(251, 191, 36, 0.15)',
        color: accepted ? 'var(--color-sage)' : 'var(--color-warning)',
      }}
    >
      {accepted ? 'Accepted' : 'Pending'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Share Form (inline)
// ---------------------------------------------------------------------------

function ShareForm({ onSubmit, onCancel }: { onSubmit: (data: ShareFormValues) => void; onCancel: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    watch,
  } = useForm<ShareFormValues>({
    resolver: zodResolver(shareSchema),
    defaultValues: {
      shared_with_email: '',
      access_level: 'read',
      shared_sections: ['medications', 'labs', 'vitals', 'conditions'],
    },
  });

  const selectedSections = watch('shared_sections');

  const toggleSection = (key: ShareableSection) => {
    const current = selectedSections || [];
    const updated = current.includes(key)
      ? current.filter((s) => s !== key)
      : [...current, key];
    setValue('shared_sections', updated, { shouldValidate: true });
  };

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
          Recipient Email
        </label>
        <input
          type="email"
          {...register('shared_with_email')}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
          style={{ ...inputStyle, '--tw-ring-color': 'var(--color-sage)' } as React.CSSProperties}
          placeholder="doctor@example.com"
        />
        {errors.shared_with_email && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
            {errors.shared_with_email.message}
          </p>
        )}
      </div>

      {/* Access Level */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
          Access Level
        </label>
        <select
          {...register('access_level')}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none cursor-pointer"
          style={inputStyle}
        >
          <option value="read">Read Only</option>
          <option value="read_write">Read &amp; Write</option>
        </select>
      </div>

      {/* Sections */}
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
          Sections to Share
        </label>
        <div className="flex flex-wrap gap-2">
          {ALL_SECTIONS.map((s) => {
            const selected = (selectedSections || []).includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleSection(s.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer"
                style={{
                  backgroundColor: selected ? 'rgba(96, 165, 250, 0.15)' : 'transparent',
                  borderColor: selected ? 'var(--color-sage)' : 'var(--border-card)',
                  color: selected ? 'var(--color-sage)' : 'var(--color-text-muted)',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {errors.shared_sections && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
            {errors.shared_sections.message}
          </p>
        )}
      </div>

      {/* Expiration date (optional) */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
          Expiration Date <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          type="date"
          {...register('expires_at')}
          min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
          style={{ ...inputStyle, '--tw-ring-color': 'var(--color-sage)' } as React.CSSProperties}
        />
        {errors.expires_at && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
            {errors.expires_at.message}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          {isSubmitting ? 'Sending...' : 'Send Invitation'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          style={{ backgroundColor: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--border-card)' }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sent Share Row
// ---------------------------------------------------------------------------

function SentShareRow({
  share,
  onRevoke,
}: {
  share: HealthShare;
  onRevoke: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    if (!share.share_token) return;
    const url = `${window.location.origin}/shared/${share.share_token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {share.shared_with_email}
          </span>
          <AccessBadge level={share.access_level} />
          <StatusBadge accepted={share.accepted} expiresAt={share.expires_at} />
        </div>
        <div className="flex flex-wrap">
          {share.shared_sections.map((s) => (
            <SectionTag key={s} section={s} />
          ))}
        </div>
        {share.expires_at && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {new Date(share.expires_at) < new Date() ? 'Expired' : 'Expires'}:{' '}
            {new Date(share.expires_at).toLocaleDateString()}
          </p>
        )}
      </div>
      <div className="flex gap-2 self-start sm:self-center">
        {share.share_token && (
          <button
            onClick={handleCopyLink}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: copied ? 'rgba(129, 178, 154, 0.15)' : 'rgba(96, 165, 250, 0.1)',
              color: copied ? 'var(--color-sage)' : 'var(--color-text-muted)',
              border: `1px solid ${copied ? 'rgba(129, 178, 154, 0.4)' : 'rgba(96, 165, 250, 0.3)'}`,
            }}
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        )}
        <button
          onClick={() => onRevoke(share.id)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          style={{
            backgroundColor: 'rgba(248, 113, 113, 0.1)',
            color: 'var(--color-terracotta)',
            border: '1px solid rgba(248, 113, 113, 0.3)',
          }}
        >
          Revoke
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Received Share Row
// ---------------------------------------------------------------------------

function ReceivedShareRow({
  share,
  onAccept,
  onDecline,
}: {
  share: HealthShare;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}) {
  return (
    <div
      className="rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            From: {share.shared_with_email === '' ? share.owner_id : `Owner (${share.owner_id.slice(0, 8)}...)`}
          </span>
          <AccessBadge level={share.access_level} />
          <StatusBadge accepted={share.accepted} expiresAt={share.expires_at} />
        </div>
        <div className="flex flex-wrap">
          {share.shared_sections.map((s) => (
            <SectionTag key={s} section={s} />
          ))}
        </div>
        {share.expires_at && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Expires: {new Date(share.expires_at).toLocaleDateString()}
          </p>
        )}
      </div>
      <div className="flex gap-2 self-start sm:self-center">
        {share.accepted ? (
          <a
            href={`/shared/${share.share_token}`}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: 'rgba(96, 165, 250, 0.1)',
              color: 'var(--color-sage)',
              border: '1px solid rgba(96, 165, 250, 0.3)',
            }}
          >
            View Data
          </a>
        ) : (
          <>
            <button
              onClick={() => onAccept(share.id)}
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
              onClick={() => onDecline(share.id)}
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
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading Skeletons
// ---------------------------------------------------------------------------

function ShareListSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} variant="card" className="h-[80px]" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function HealthShareManager() {
  const [tab, setTab] = useState<'sent' | 'received'>('sent');
  const [showForm, setShowForm] = useState(false);
  const {
    sentShares,
    receivedShares,
    loading,
    error,
    createShare,
    acceptShare,
    revokeShare,
  } = useHealthShares();

  const handleCreate = async (data: ShareFormValues) => {
    const result = await createShare({
      shared_with_email: data.shared_with_email,
      access_level: data.access_level,
      shared_sections: data.shared_sections,
      expires_at: data.expires_at,
    });
    if (result) {
      setShowForm(false);
    }
  };

  const tabs = [
    { key: 'sent' as const, label: 'Shared by Me', count: sentShares.length },
    { key: 'received' as const, label: 'Shared with Me', count: receivedShares.length },
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
          style={{ backgroundColor: 'rgba(248, 113, 113, 0.1)', borderColor: 'rgba(248, 113, 113, 0.3)', color: 'var(--color-terracotta)' }}
        >
          {error}
        </div>
      )}

      {/* Sent tab */}
      {tab === 'sent' && (
        <div className="space-y-3">
          {/* Add button / form */}
          {showForm ? (
            <ShareForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer border border-dashed"
              style={{ borderColor: 'var(--border-card)', color: 'var(--color-sage)', backgroundColor: 'transparent' }}
            >
              + Share Health Data
            </button>
          )}

          {loading ? (
            <ShareListSkeleton />
          ) : sentShares.length === 0 ? (
            <EmptyState
              icon={
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }
              title="No shares yet"
              description="Share your health data with family members, caregivers, or healthcare providers."
              action={{ label: 'Share Health Data', onClick: () => setShowForm(true) }}
            />
          ) : (
            sentShares.map((share) => (
              <SentShareRow key={share.id} share={share} onRevoke={revokeShare} />
            ))
          )}
        </div>
      )}

      {/* Received tab */}
      {tab === 'received' && (
        <div className="space-y-3">
          {loading ? (
            <ShareListSkeleton />
          ) : receivedShares.length === 0 ? (
            <EmptyState
              icon={
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              }
              title="No shared data"
              description="When someone shares their health data with you, it will appear here."
            />
          ) : (
            receivedShares.map((share) => (
              <ReceivedShareRow
                key={share.id}
                share={share}
                onAccept={acceptShare}
                onDecline={revokeShare}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
