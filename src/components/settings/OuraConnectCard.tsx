'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useOura } from '@/hooks/useOura';

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="28"
        strokeDashoffset="8"
        strokeLinecap="round"
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </svg>
  );
}

type Banner = { type: 'success' | 'error'; message: string };

// Derive the one-time banner from the ?oura=... OAuth callback redirect
// params. Pure — safe to call from a state initializer.
function bannerFromOAuthRedirect(params: { get(name: string): string | null }): Banner | null {
  const ouraParam = params.get('oura');

  if (ouraParam === 'connected') {
    return { type: 'success', message: 'Oura Ring connected! Syncing your data…' };
  }

  if (ouraParam === 'error') {
    const reason = params.get('reason') ?? 'unknown';
    const messages: Record<string, string> = {
      missing_code: 'Authorization was not completed. Please try again.',
      invalid_state: 'The authorization link expired or did not match this session. Please try connecting again.',
      token_exchange_failed: 'Failed to connect to Oura. Please try again.',
      save_failed: 'Connected to Oura but failed to save. Please try again.',
      config_error: 'Oura integration is not configured. Please contact support.',
    };
    return { type: 'error', message: messages[reason] ?? `Connection failed: ${reason}` };
  }

  return null;
}

function formatLastSync(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs} hr ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function OuraConnectCard() {
  const { connected, lastSync, syncing, loading, error, connect, disconnect, sync } =
    useOura();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Handle ?oura=connected or ?oura=error&reason=... from the OAuth callback
  // redirect. The redirect always lands as a fresh navigation, so reading the
  // params once in the state initializer is equivalent to the old on-mount
  // effect — without setState-in-effect cascading renders.
  const [banner, setBanner] = useState<Banner | null>(() => bannerFromOAuthRedirect(searchParams));

  // Clear the query params so refreshing doesn't re-show the banner
  useEffect(() => {
    if (!searchParams.get('oura')) return;

    const url = new URL(window.location.href);
    url.searchParams.delete('oura');
    url.searchParams.delete('reason');
    router.replace(url.pathname + url.search, { scroll: false });
  }, [searchParams, router]);

  if (loading) {
    return (
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: '12px',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Spinner />
          <span style={{ color: 'var(--color-text-muted)' }}>Loading Oura status...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: '12px',
        padding: '24px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Oura Ring icon */}
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'var(--border-card)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="#A78BFA"
                strokeWidth="2"
                fill="none"
              />
              <circle
                cx="12"
                cy="12"
                r="5"
                stroke="#A78BFA"
                strokeWidth="1.5"
                fill="none"
              />
            </svg>
          </div>
          <div>
            <div style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '16px' }}>
              Oura Ring
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
              Sleep, heart rate, HRV &amp; SpO2
            </div>
          </div>
        </div>

        {connected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--color-sage)',
              }}
            />
            <span style={{ color: 'var(--color-sage)', fontSize: '13px', fontWeight: 500 }}>
              Connected
            </span>
          </div>
        )}
      </div>

      {/* OAuth callback banner */}
      {banner && (
        <div
          style={{
            background: banner.type === 'success'
              ? 'rgba(134, 169, 106, 0.12)'
              : 'rgba(248, 113, 113, 0.1)',
            border: `1px solid ${banner.type === 'success' ? 'rgba(134, 169, 106, 0.4)' : 'rgba(248, 113, 113, 0.3)'}`,
            borderRadius: '8px',
            padding: '10px 12px',
            marginBottom: '16px',
            color: banner.type === 'success' ? 'var(--color-sage)' : 'var(--color-terracotta)',
            fontSize: '13px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{banner.message}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            background: 'rgba(248, 113, 113, 0.1)',
            border: '1px solid rgba(248, 113, 113, 0.3)',
            borderRadius: '8px',
            padding: '10px 12px',
            marginBottom: '16px',
            color: 'var(--color-terracotta)',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {/* Connected state */}
      {connected && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
              padding: '10px 12px',
              background: 'var(--bg-primary)',
              borderRadius: '8px',
            }}
          >
            <span style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>Last synced</span>
            <span
              className="font-mono"
              style={{ color: 'var(--color-text-primary)', fontSize: '13px' }}
            >
              {formatLastSync(lastSync)}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={() => sync()}
              disabled={syncing}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-primary)',
                color: 'var(--color-sage)',
                fontSize: '14px',
                fontWeight: 500,
                cursor: syncing ? 'not-allowed' : 'pointer',
                opacity: syncing ? 0.6 : 1,
              }}
            >
              {syncing ? <Spinner /> : null}
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>

            {!confirmDisconnect ? (
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                style={{
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: '1px solid rgba(248, 113, 113, 0.3)',
                  background: 'transparent',
                  color: 'var(--color-terracotta)',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Disconnect
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={async () => {
                    await disconnect();
                    setConfirmDisconnect(false);
                  }}
                  style={{
                    padding: '10px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'var(--color-terracotta)',
                    color: 'var(--color-bark)',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(false)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-card)',
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Disconnected state */}
      {!connected && (
        <button
          type="button"
          onClick={connect}
          style={{
            width: '100%',
            padding: '12px 20px',
            borderRadius: '8px',
            border: 'none',
            background: 'var(--color-sage)',
            color: 'var(--color-bark)',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Connect Oura Ring
        </button>
      )}
    </div>
  );
}
