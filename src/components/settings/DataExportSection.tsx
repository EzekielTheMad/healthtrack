'use client';

import { useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import { useExport } from '@/hooks/useExport';
import { authClient, useSession } from '@/lib/auth/client';
import HandoffAccountRecovery from '@/components/mobile/HandoffAccountRecovery';

const LAST_EXPORT_KEY = 'healthtrack_last_export';

// localStorage is an external store: subscribe to cross-tab writes via the
// `storage` event; same-tab writes (useExport) flip `exporting`, which
// re-renders and re-reads the snapshot.
function subscribeToStorage(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getLastExportSnapshot() {
  return localStorage.getItem(LAST_EXPORT_KEY);
}

function getLastExportServerSnapshot() {
  return null;
}

const INCLUDED_DATA = [
  'Profile',
  'Medications',
  'Conditions',
  'Lab results',
  'Detailed clinical history and dose events',
  'Body scans and source measurements',
  'Clinical correction history',
  'Vitals (last 90 days)',
  'Appointments',
  'Notes',
  'Providers',
];

export default function DataExportSection() {
  const { exporting, error, requiresReauth, exportData, confirmedAuthentication } = useExport();
  const { data: session } = useSession();
  const [reauthenticating, setReauthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authConfirmed, setAuthConfirmed] = useState(false);
  const lastExport = useSyncExternalStore(
    subscribeToStorage,
    getLastExportSnapshot,
    getLastExportServerSnapshot
  );

  async function confirmExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reauthenticating || exporting || !session?.user.email) return;
    const form = event.currentTarget;
    setReauthenticating(true);
    setAuthError(null);
    try {
      const { error: signInError } = await authClient.signIn.email({
        email: session.user.email,
        password: String(new FormData(form).get('password') ?? ''),
      });
      if (signInError) {
        setAuthError('Could not confirm your password. Please try again, or sign in again below.');
        return;
      }
      form.reset();
      // A new session can remount this view. Never download from its old sign-in closure.
      // The user starts the export from the current, authenticated account view.
      confirmedAuthentication();
      setAuthConfirmed(true);
    } catch {
      setAuthError('Could not confirm your password. Please try again.');
    } finally {
      setReauthenticating(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Download the listed records for you and your dependents as a structured JSON file, including
        detailed clinical history, source scan values and correction history. Vitals cover the last
        90 days. This export omits uploaded files, fitness, nutrition, and integration history. For
        a complete backup and restore, preserve the stopped container&apos;s entire data volume and
        configuration.
      </p>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        After confirming your password or signing in again, select Export as JSON to start the
        download.
      </p>

      <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        <p className="mb-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>
          Included in export:
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {INCLUDED_DATA.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span style={{ color: 'var(--color-sage)' }}>&#10003;</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={() => exportData('json')}
          disabled={exporting || reauthenticating}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: exporting ? 'var(--border-card)' : 'var(--color-sage)',
            color: 'var(--color-sage)',
            border: '1px solid #16a34a',
          }}
        >
          {exporting ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Exporting…
            </span>
          ) : (
            'Export as JSON'
          )}
        </button>

        {lastExport && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Last export: {new Date(lastExport).toLocaleDateString()}
          </span>
        )}
      </div>

      {requiresReauth && (
        <form
          onSubmit={confirmExport}
          className="space-y-3 rounded-lg border border-[var(--border-card)] p-4"
          aria-label="Confirm data export"
        >
          <p className="text-sm">
            Confirm your password, then select Export as JSON above to download your health records.
            Your browser can fill your saved login.
          </p>
          <label className="block text-sm">
            Account email
            <input
              type="email"
              name="username"
              autoComplete="username"
              value={session?.user.email ?? ''}
              readOnly
              className="mt-1 block w-full rounded border p-2"
            />
          </label>
          <label className="block text-sm">
            Current password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              disabled={reauthenticating || exporting}
              className="mt-1 block w-full rounded border p-2"
            />
          </label>
          <button
            type="submit"
            disabled={reauthenticating || exporting || !session?.user.email}
            className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
          >
            {reauthenticating ? 'Confirming…' : 'Confirm password'}
          </button>
          <HandoffAccountRecovery
            signedIn
            returnTo="/settings?tab=data"
            actionLabel="Sign in again"
            description="If you use Google or need another sign-in method, sign in again with this account, then return here to export."
          />
          {authError && (
            <p role="alert" className="text-sm">
              {authError}
            </p>
          )}
        </form>
      )}

      {authConfirmed && !requiresReauth && (
        <p role="status" className="text-sm">
          Password confirmed. Select Export as JSON to download your records.
        </p>
      )}

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
    </div>
  );
}
