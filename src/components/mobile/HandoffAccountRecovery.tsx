'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { safeReturnTo } from '@/lib/auth/return-to';

export default function HandoffAccountRecovery({
  returnTo,
  signedIn,
}: {
  returnTo: string;
  signedIn: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const href = `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
  async function restartSignIn() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error('Could not clear session.');
      // Clear even an expired cookie: the proxy intentionally checks presence only.
      // Reset client state and preserve only a validated local continuation.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = href;
    } catch {
      setError('Could not clear the current session. Try again.');
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <p>
        Use the same account that opened this browser handoff. The selected person will be checked
        again after sign-in.
      </p>
      {signedIn ? (
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-lg border px-3"
          style={{ borderColor: 'var(--border-card)' }}
          onClick={() => void restartSignIn()}
        >
          {busy ? 'Signing out…' : 'Switch account'}
        </button>
      ) : (
        <a
          href={href}
          aria-disabled={busy}
          onClick={(event) => {
            event.preventDefault();
            void restartSignIn();
          }}
          className="inline-flex min-h-11 items-center underline"
        >
          {busy ? 'Clearing expired session…' : 'Sign in again'}
        </a>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
