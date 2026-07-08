'use client';

import { useEffect, useState } from 'react';
import { authClient, useSession } from '@/lib/auth/client';

interface AuthStepProps {
  onNext: () => void;
  onBack: () => void;
}

interface LinkedProvider {
  provider: string;
  linked: boolean;
}

export function AuthStep({ onNext }: AuthStepProps) {
  const { data: session } = useSession();
  const [linkedProviders, setLinkedProviders] = useState<LinkedProvider[]>([]);
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Better Auth: linked OAuth identities live in the account table
    authClient
      .listAccounts()
      .then(({ data }) => {
        if (cancelled) return;
        const providerNames = (data ?? []).map((account) => account.providerId);
        setLinkedProviders([
          { provider: 'google', linked: providerNames.includes('google') },
        ]);
      })
      .catch(() => {
        if (!cancelled) {
          setLinkedProviders([{ provider: 'google', linked: false }]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLinkProvider = async (provider: 'google') => {
    setLinking(provider);
    try {
      // Redirects to the provider's consent screen and back here
      await authClient.linkSocial({
        provider,
        callbackURL: window.location.href,
      });
    } catch {
      // Linking redirects away; errors are expected if the popup is blocked
    } finally {
      setLinking(null);
    }
  };

  const providerLabel: Record<string, string> = {
    google: 'Google',
  };

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
        Account
      </h2>
      <p className="text-sm mb-8" style={{ color: 'var(--color-text-muted)' }}>
        Verify your sign-in and optionally link additional providers.
      </p>

      {/* Current user info */}
      <div
        className="w-full rounded-xl border p-5 mb-6"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <p className="text-sm mb-1" style={{ color: 'var(--color-text-muted)' }}>
          Signed in as
        </p>
        <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {session?.user?.email ?? 'Loading...'}
        </p>
      </div>

      {/* Link additional providers */}
      <div className="w-full space-y-3 mb-8">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
          Link additional providers
        </p>
        {linkedProviders.map(({ provider, linked }) => (
          <div
            key={provider}
            className="flex items-center justify-between rounded-xl border p-4"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
          >
            <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {providerLabel[provider] ?? provider}
            </span>
            {linked ? (
              <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-sage)' }}>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Linked
              </span>
            ) : (
              <button
                type="button"
                onClick={() => handleLinkProvider(provider as 'google')}
                disabled={linking === provider}
                className="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--color-cream)',
                  color: 'var(--color-sage)',
                  borderWidth: 1,
                  borderColor: 'var(--border-card)',
                }}
              >
                {linking === provider ? 'Linking...' : `Link ${providerLabel[provider]} Account`}
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onNext}
        className="px-8 py-3 rounded-lg font-medium text-sm transition-colors hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
      >
        Continue
      </button>
    </div>
  );
}
