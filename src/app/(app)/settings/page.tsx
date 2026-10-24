'use client';

import { Suspense, useState } from 'react';
import { ProfileForm } from '@/components/settings/ProfileForm';
import { ProviderManagement } from '@/components/settings/ProviderManagement';
import DataExportSection from '@/components/settings/DataExportSection';
import PdfExportSection from '@/components/export/PdfExportSection';
import HealthShareManager from '@/components/settings/HealthShareManager';
import DependentManager from '@/components/settings/DependentManager';
import MedicalHistoryImport from '@/components/settings/MedicalHistoryImport';
import DelegateManager from '@/components/settings/DelegateManager';
import ApiKeyManager from '@/components/settings/ApiKeyManager';
import InviteManager from '@/components/settings/InviteManager';
import IntegrationOverview from '@/components/settings/IntegrationOverview';
import BuildIdentity from '@/components/settings/BuildIdentity';
import SettingsGroups from '@/components/settings/SettingsGroups';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useSession } from '@/lib/auth/client';
import { useRouter } from 'next/navigation';

// Native disclosures keep their forms mounted when closed and expose their
// expanded state to keyboard and screen-reader users without a second state.
function SettingsSection({
  id,
  title,
  description,
  defaultOpen = false,
  borderColor,
  children,
}: {
  id: string;
  title: string;
  description: string;
  defaultOpen?: boolean;
  borderColor?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className="rounded-xl border scroll-mt-6"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: borderColor ?? 'var(--border-card)',
      }}
    >
      <summary className="min-h-11 cursor-pointer rounded-xl p-4 sm:p-5 focus-visible:outline-2 focus-visible:outline-offset-2">
        <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </span>
        <span className="mt-1 block text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {description}
        </span>
      </summary>
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>
    </details>
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
      setError(err instanceof Error ? err.message : 'Failed to delete account');
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
          This will permanently delete your account and all associated health data. This action{' '}
          <strong style={{ color: 'var(--color-terracotta)' }}>cannot</strong> be undone.
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
  // Visibility is a convenience; the invite API also enforces the admin role.
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';

  return (
    <div className="min-w-0 space-y-6">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        Settings
      </h1>
      <SettingsGroups
        panels={{
          profile: (
            <SettingsSection
              id="profile"
              title="Personal information"
              description="Manage your personal information, date of birth, and biological details."
              defaultOpen
            >
              <ProfileForm />
            </SettingsSection>
          ),
          integrations: <IntegrationOverview />,
          people: (
            <>
              <SettingsSection
                id="providers"
                title="Providers"
                description="Manage your healthcare providers and their contact information."
              >
                <ProviderManagement />
              </SettingsSection>
              <SettingsSection
                id="dependents-section"
                title="Family & Dependents"
                description="Manage family members and dependents whose health data you track."
              >
                <DependentManager />
              </SettingsSection>
              <SettingsSection
                id="delegates"
                title="Delegate Access"
                description="Grant other adults account-level access to view or manage your health data."
              >
                <DelegateManager />
              </SettingsSection>
              <SettingsSection
                id="health-sharing"
                title="Health Sharing"
                description="Share your health data with family members, caregivers, or providers."
              >
                <HealthShareManager />
              </SettingsSection>
              {isAdmin && (
                <SettingsSection
                  id="invites"
                  title="Invites"
                  description="Create single-use invite links so family members can register on this instance."
                >
                  <InviteManager />
                </SettingsSection>
              )}
            </>
          ),
          data: (
            <>
              <SettingsSection
                id="medical-history"
                title="Import Medical History"
                description="Review saved document imports, or extract a medical history for you or a dependent."
              >
                <MedicalHistoryImport extractionEnabled={capabilities?.ai === true} />
              </SettingsSection>
              <SettingsSection
                id="data-export"
                title="Data Export"
                description="Export your health data as a JSON file for personal backup."
              >
                <DataExportSection />
              </SettingsSection>
              <SettingsSection
                id="pdf-summary"
                title="PDF Health Summary"
                description="Download a formatted PDF health summary to share with doctors offline."
              >
                <PdfExportSection />
              </SettingsSection>
            </>
          ),
          advanced: (
            <>
              <SettingsSection
                id="api-access"
                title="API access"
                description="Generate tokens for Hermes, device bridges, and other external apps or scripts."
              >
                <ApiKeyManager />
              </SettingsSection>
              <div id="build" className="scroll-mt-6">
                <h3 className="mb-2 font-semibold">About this instance</h3>
                <BuildIdentity />
              </div>
              <SettingsSection
                id="danger-zone"
                title="Danger Zone"
                description="Permanently delete your account and all associated health data."
                borderColor="#991B1B"
              >
                <div className="space-y-4">
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    Once you delete your account, all of your data will be permanently removed. This
                    action cannot be undone.
                  </p>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="min-h-11 rounded-lg px-4 py-2 text-sm font-medium transition-colors cursor-pointer hover:bg-red-900/80"
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
            </>
          ),
        }}
      />
      {showDeleteModal && <DeleteAccountModal onClose={() => setShowDeleteModal(false)} />}
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
