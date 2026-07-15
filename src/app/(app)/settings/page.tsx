'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ProfileForm } from '@/components/settings/ProfileForm';
import { ProviderManagement } from '@/components/settings/ProviderManagement';
import DataExportSection from '@/components/settings/DataExportSection';
import PdfExportSection from '@/components/export/PdfExportSection';
import { OuraConnectCard } from '@/components/settings/OuraConnectCard';
import HealthShareManager from '@/components/settings/HealthShareManager';
import DependentManager from '@/components/settings/DependentManager';
import DelegateManager from '@/components/settings/DelegateManager';
import ApiKeyManager from '@/components/settings/ApiKeyManager';
import InviteManager from '@/components/settings/InviteManager';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useSession } from '@/lib/auth/client';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Chevron icon
// ---------------------------------------------------------------------------
function ChevronIcon({ rotated }: { rotated: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      style={{
        transform: rotated ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 200ms ease',
        flexShrink: 0,
      }}
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="var(--color-text-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section wrapper
// ---------------------------------------------------------------------------
function SettingsSection({
  title,
  description,
  defaultOpen = false,
  borderColor,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  borderColor?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded-xl border"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: borderColor ?? 'var(--border-card)',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-6 flex justify-between items-center text-left cursor-pointer"
        type="button"
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </h2>
          {!open && (
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {description}
            </p>
          )}
        </div>
        <ChevronIcon rotated={open} />
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete-account confirmation modal
// ---------------------------------------------------------------------------
function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const confirmed = confirmText === 'DELETE';

  async function handleDelete() {
    if (!confirmed) return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to delete account');
      }

      // Server already destroyed the session and expired the cookie.
      router.push('/login');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to delete account',
      );
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="w-full max-w-md rounded-xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--color-terracotta)' }}
      >
        <h3 className="text-lg font-semibold" style={{ color: 'var(--color-terracotta)' }}>
          Delete Account
        </h3>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          This will permanently delete your account and all associated health
          data. This action <strong style={{ color: 'var(--color-terracotta)' }}>cannot</strong>{' '}
          be undone.
        </p>
        <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
          Type <strong>DELETE</strong> to confirm:
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--border-card)',
          }}
        />

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

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!confirmed || deleting}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: confirmed ? 'var(--color-terracotta)' : 'var(--border-card)',
              color: 'var(--color-terracotta)',
            }}
            type="button"
          >
            {deleting ? 'Deleting…' : 'Delete My Account'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------
function SettingsContent() {
  const { capabilities } = useCapabilities();
  const { data: session } = useSession();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const searchParams = useSearchParams();
  const hasOuraParam = searchParams.has('oura');
  // `role` is a server-side additional field; the client session type doesn't
  // narrow it, hence the cast. Non-admins simply don't see the section (the
  // API enforces 403 regardless).
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        Settings
      </h1>

      {/* Profile */}
      <SettingsSection
        title="Profile"
        description="Manage your personal information, date of birth, and biological details."
        defaultOpen
      >
        <ProfileForm />
      </SettingsSection>

      {/* Providers */}
      <SettingsSection
        title="Providers"
        description="Manage your healthcare providers and their contact information."
      >
        <ProviderManagement />
      </SettingsSection>

      {/* Family & Dependents */}
      <SettingsSection
        title="Family & Dependents"
        description="Manage family members and dependents whose health data you track."
      >
        <DependentManager />
      </SettingsSection>

      {/* Connected Sources — hidden when the instance has no Oura app configured */}
      {capabilities?.oura !== false && (
        <SettingsSection
          title="Connected Sources"
          description="Manage wearable and health data integrations like Oura Ring."
          defaultOpen={hasOuraParam}
        >
          <OuraConnectCard />
        </SettingsSection>
      )}

      {/* Invites — admin only (registration is invite-only by default) */}
      {isAdmin && (
        <SettingsSection
          title="Invites"
          description="Create single-use invite links so family members can register on this instance."
        >
          <InviteManager />
        </SettingsSection>
      )}

      {/* Delegate Access */}
      <SettingsSection
        title="Delegate Access"
        description="Grant other adults account-level access to view or manage your health data."
      >
        <DelegateManager />
      </SettingsSection>

      {/* API Access */}
      <SettingsSection
        title="API Access"
        description="Generate tokens to access your health data from external apps and scripts."
      >
        <ApiKeyManager />
      </SettingsSection>

      {/* Health Sharing */}
      <SettingsSection
        title="Health Sharing"
        description="Share your health data with family members, caregivers, or providers."
      >
        <HealthShareManager />
      </SettingsSection>

      {/* Data Export */}
      <SettingsSection
        title="Data Export"
        description="Export your health data as a JSON file for personal backup."
      >
        <DataExportSection />
      </SettingsSection>

      {/* PDF Export */}
      <SettingsSection
        title="PDF Health Summary"
        description="Download a formatted PDF health summary to share with doctors offline."
      >
        <PdfExportSection />
      </SettingsSection>

      {/* Danger Zone */}
      <SettingsSection
        title="Danger Zone"
        description="Permanently delete your account and all associated health data."
        borderColor="#991B1B"
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Once you delete your account, all of your data will be permanently
            removed. This action cannot be undone.
          </p>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer hover:bg-red-900/80"
            style={{
              backgroundColor: 'rgba(127,29,29,0.5)',
              color: 'var(--color-terracotta)',
              border: '1px solid #991B1B',
            }}
            type="button"
          >
            Delete Account
          </button>
        </div>
      </SettingsSection>

      {showDeleteModal && (
        <DeleteAccountModal onClose={() => setShowDeleteModal(false)} />
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
