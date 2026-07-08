'use client';

import { useState } from 'react';
import { AVAILABLE_SCOPES } from '@/lib/api-scopes';
import { useApiKeys, type ApiKey } from '@/hooks/useApiKeys';
import Skeleton from '@/components/shared/Skeleton';
import EmptyState from '@/components/shared/EmptyState';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Earliest selectable expiration date (tomorrow). Computed once at module
// load, outside render, so the component stays pure.
const MIN_EXPIRES_AT = new Date(Date.now() + 86400000).toISOString().split('T')[0];

function getKeyStatus(key: ApiKey): 'revoked' | 'expired' | 'active' {
  if (key.revoked_at) return 'revoked';
  if (key.expires_at && new Date(key.expires_at) < new Date()) return 'expired';
  return 'active';
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

function ScopeBadge({ scope }: { scope: string }) {
  const isPowerScope = scope === 'read:all' || scope === 'write:all';
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full mr-1 mb-1 font-medium"
      style={{
        backgroundColor: isPowerScope
          ? 'rgba(251, 191, 36, 0.15)'
          : 'rgba(129, 178, 154, 0.15)',
        color: isPowerScope ? 'var(--color-warning)' : 'var(--color-sage)',
        border: isPowerScope ? '1px solid rgba(251, 191, 36, 0.3)' : 'none',
      }}
    >
      {scope}
    </span>
  );
}

function StatusBadge({ status }: { status: 'active' | 'expired' | 'revoked' }) {
  const styles = {
    active: { bg: 'rgba(129, 178, 154, 0.15)', color: 'var(--color-sage)', label: 'Active' },
    expired: { bg: 'rgba(156, 163, 175, 0.15)', color: 'var(--color-text-muted)', label: 'Expired' },
    revoked: { bg: 'rgba(248, 113, 113, 0.15)', color: 'var(--color-terracotta)', label: 'Revoked' },
  };
  const s = styles[status];
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New Key Form
// ---------------------------------------------------------------------------

interface NewKeyFormProps {
  onSubmit: (data: { name: string; scopes: string[]; expires_at?: string }) => Promise<void>;
  onCancel: () => void;
}

function NewKeyForm({ onSubmit, onCancel }: NewKeyFormProps) {
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState('');
  const [scopeError, setScopeError] = useState('');

  const toggleScope = (value: string) => {
    setSelectedScopes((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
    setScopeError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let valid = true;

    if (!name.trim()) {
      setNameError('Name is required');
      valid = false;
    } else {
      setNameError('');
    }

    if (selectedScopes.length === 0) {
      setScopeError('Select at least one scope');
      valid = false;
    } else {
      setScopeError('');
    }

    if (!valid) return;

    setSubmitting(true);
    await onSubmit({
      name: name.trim(),
      scopes: selectedScopes,
      expires_at: expiresAt || undefined,
    });
    setSubmitting(false);
  };

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-primary)',
    borderColor: 'var(--border-card)',
    color: 'var(--color-text-primary)',
  };

  const powerScopes = AVAILABLE_SCOPES.filter(
    (s) => s.value === 'read:all' || s.value === 'write:all',
  );
  const granularScopes = AVAILABLE_SCOPES.filter(
    (s) => s.value !== 'read:all' && s.value !== 'write:all',
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border p-4 mb-4 space-y-4"
      style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
    >
      {/* Name */}
      <div>
        <label
          className="block text-sm font-medium mb-1"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Key Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) setNameError('');
          }}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
          style={{ ...inputStyle, '--tw-ring-color': 'var(--color-sage)' } as React.CSSProperties}
          placeholder="e.g. Home Assistant, iOS Shortcuts"
        />
        {nameError && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-terracotta)' }}>
            {nameError}
          </p>
        )}
      </div>

      {/* Scopes */}
      <div>
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Scopes
        </label>

        {/* Power scopes */}
        <div className="mb-3">
          <p className="text-xs mb-2 font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
            Broad Access
          </p>
          <div className="flex flex-wrap gap-2">
            {powerScopes.map((scope) => {
              const selected = selectedScopes.includes(scope.value);
              return (
                <label
                  key={scope.value}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors"
                  style={{
                    backgroundColor: selected ? 'rgba(251, 191, 36, 0.1)' : 'transparent',
                    borderColor: selected ? 'rgba(251, 191, 36, 0.4)' : 'var(--border-card)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleScope(scope.value)}
                    className="mt-0.5 cursor-pointer"
                    style={{ accentColor: 'var(--color-warning)' }}
                  />
                  <div>
                    <span
                      className="text-xs font-semibold"
                      style={{ color: selected ? 'var(--color-warning)' : 'var(--color-text-primary)' }}
                    >
                      {scope.label}
                    </span>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {scope.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Granular scopes */}
        <div>
          <p className="text-xs mb-2 font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
            Granular Access
          </p>
          <div className="flex flex-wrap gap-2">
            {granularScopes.map((scope) => {
              const selected = selectedScopes.includes(scope.value);
              return (
                <label
                  key={scope.value}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors"
                  style={{
                    backgroundColor: selected ? 'rgba(129, 178, 154, 0.1)' : 'transparent',
                    borderColor: selected ? 'rgba(129, 178, 154, 0.4)' : 'var(--border-card)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleScope(scope.value)}
                    className="mt-0.5 cursor-pointer"
                    style={{ accentColor: 'var(--color-sage)' }}
                  />
                  <div>
                    <span
                      className="text-xs font-semibold"
                      style={{ color: selected ? 'var(--color-sage)' : 'var(--color-text-primary)' }}
                    >
                      {scope.label}
                    </span>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {scope.description}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {scopeError && (
          <p className="text-xs mt-2" style={{ color: 'var(--color-terracotta)' }}>
            {scopeError}
          </p>
        )}
      </div>

      {/* Expiration */}
      <div>
        <label
          className="block text-sm font-medium mb-1"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Expiration Date{' '}
          <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          min={MIN_EXPIRES_AT}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
          style={{ ...inputStyle, '--tw-ring-color': 'var(--color-sage)' } as React.CSSProperties}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))',
            color: 'white',
            boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)',
          }}
        >
          {submitting ? 'Generating...' : 'Generate Key'}
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
// Token reveal (shown once after creation)
// ---------------------------------------------------------------------------

function NewTokenReveal({ token, onDone }: { token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="rounded-lg border p-4 mb-4 space-y-3"
      style={{
        backgroundColor: 'rgba(129, 178, 154, 0.08)',
        borderColor: 'rgba(129, 178, 154, 0.4)',
      }}
    >
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-sage)" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-sage)' }}>
          API key generated successfully
        </span>
      </div>

      <div
        className="rounded-lg border p-3 flex items-center gap-2"
        style={{
          backgroundColor: 'var(--bg-primary)',
          borderColor: 'var(--border-card)',
        }}
      >
        <code
          className="flex-1 text-xs break-all font-mono"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {token}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
          style={{
            backgroundColor: copied ? 'rgba(129, 178, 154, 0.2)' : 'rgba(129, 178, 154, 0.1)',
            color: copied ? 'var(--color-sage)' : 'var(--color-text-muted)',
            border: `1px solid ${copied ? 'rgba(129, 178, 154, 0.4)' : 'var(--border-card)'}`,
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <div
        className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
        style={{
          backgroundColor: 'rgba(251, 191, 36, 0.1)',
          border: '1px solid rgba(251, 191, 36, 0.3)',
          color: 'var(--color-warning)',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0 mt-0.5"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        Save this token now — you won&apos;t be able to see it again.
      </div>

      <button
        type="button"
        onClick={onDone}
        className="px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
        style={{
          backgroundColor: 'var(--bg-card)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--border-card)',
        }}
      >
        Done
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Key row
// ---------------------------------------------------------------------------

function ApiKeyRow({
  apiKey,
  onRevoke,
}: {
  apiKey: ApiKey;
  onRevoke: (id: string) => void;
}) {
  const status = getKeyStatus(apiKey);
  const isRevoked = status !== 'active';

  const handleRevoke = () => {
    if (window.confirm(`Revoke "${apiKey.name}"? This cannot be undone.`)) {
      onRevoke(apiKey.id);
    }
  };

  return (
    <div
      className="rounded-lg border p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
      style={{
        backgroundColor: 'var(--bg-primary)',
        borderColor: 'var(--border-card)',
        opacity: isRevoked ? 0.55 : 1,
      }}
    >
      <div className="space-y-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {apiKey.name}
          </span>
          <StatusBadge status={status} />
        </div>

        <code
          className="text-xs font-mono block"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {apiKey.prefix}...
        </code>

        <div className="flex flex-wrap">
          {apiKey.scopes.map((s) => (
            <ScopeBadge key={s} scope={s} />
          ))}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-0.5">
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Last used: {formatDate(apiKey.last_used_at)}
          </p>
          {apiKey.expires_at && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Expires: {formatDate(apiKey.expires_at)}
            </p>
          )}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Created: {formatDate(apiKey.created_at)}
          </p>
        </div>
      </div>

      {status === 'active' && (
        <button
          type="button"
          onClick={handleRevoke}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer self-start shrink-0"
          style={{
            backgroundColor: 'rgba(248, 113, 113, 0.1)',
            color: 'var(--color-terracotta)',
            border: '1px solid rgba(248, 113, 113, 0.3)',
          }}
        >
          Revoke
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function KeyListSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <Skeleton key={i} variant="card" className="h-[100px]" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// How to use section
// ---------------------------------------------------------------------------

function HowToUseSection() {
  const [open, setOpen] = useState(false);

  const endpoints = [
    { path: '/api/v1/medications', scope: 'read:medications or read:all', method: 'GET' },
    { path: '/api/v1/conditions', scope: 'read:conditions or read:all', method: 'GET' },
    { path: '/api/v1/allergies', scope: 'read:allergies or read:all', method: 'GET' },
    { path: '/api/v1/vitals', scope: 'read:vitals or read:all', method: 'GET' },
    { path: '/api/v1/labs', scope: 'read:labs or read:all', method: 'GET' },
    { path: '/api/v1/procedures', scope: 'read:procedures or read:all', method: 'GET' },
    { path: '/api/v1/vaccines', scope: 'read:vaccines or read:all', method: 'GET' },
    { path: '/api/v1/providers', scope: 'read:providers or read:all', method: 'GET' },
    { path: '/api/v1/profile', scope: 'read:profile or read:all', method: 'GET' },
  ];

  return (
    <div
      className="rounded-lg border"
      style={{ borderColor: 'var(--border-card)' }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 flex justify-between items-center text-left cursor-pointer"
        style={{ backgroundColor: 'transparent' }}
      >
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          How to use API keys
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
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
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: 'var(--border-card)' }}>
          <div className="mt-4">
            <p className="text-sm mb-2" style={{ color: 'var(--color-text-muted)' }}>
              Pass your token in the{' '}
              <code
                className="text-xs px-1 py-0.5 rounded"
                style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--color-text-primary)' }}
              >
                Authorization
              </code>{' '}
              header as a Bearer token:
            </p>

            <pre
              className="rounded-lg p-3 text-xs font-mono overflow-x-auto"
              style={{
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--border-card)',
                lineHeight: 1.6,
              }}
            >
{`curl https://your-instance.example.com/api/v1/medications \\
  -H "Authorization: Bearer ohts_pat_..."`}
            </pre>
          </div>

          <div>
            <p className="text-sm mb-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Available endpoints
            </p>
            <div className="space-y-1">
              {endpoints.map((ep) => (
                <div
                  key={ep.path}
                  className="flex items-start gap-3 py-1.5 px-2 rounded text-xs"
                  style={{ backgroundColor: 'var(--bg-primary)' }}
                >
                  <span
                    className="shrink-0 px-1.5 py-0.5 rounded font-mono font-medium"
                    style={{
                      backgroundColor: 'rgba(129, 178, 154, 0.15)',
                      color: 'var(--color-sage)',
                    }}
                  >
                    {ep.method}
                  </span>
                  <code className="font-mono" style={{ color: 'var(--color-text-primary)' }}>
                    {ep.path}
                  </code>
                  <span className="ml-auto shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                    {ep.scope}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            See the{' '}
            <a
              href="/api/v1"
              className="underline"
              style={{ color: 'var(--color-sage)' }}
              target="_blank"
              rel="noopener noreferrer"
            >
              API discovery endpoint
            </a>{' '}
            for the full schema and response formats.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ApiKeyManager() {
  const { keys, loading, error, createKey, revokeKey } = useApiKeys();
  const [showForm, setShowForm] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const handleCreate = async (data: { name: string; scopes: string[]; expires_at?: string }) => {
    const token = await createKey(data);
    if (token) {
      setShowForm(false);
      setNewToken(token);
    }
  };

  const handleDone = () => {
    setNewToken(null);
  };

  const activeKeys = keys.filter((k) => getKeyStatus(k) === 'active');
  const inactiveKeys = keys.filter((k) => getKeyStatus(k) !== 'active');

  return (
    <div className="space-y-4">
      {/* Error banner */}
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

      {/* Token reveal (shown once) */}
      {newToken && <NewTokenReveal token={newToken} onDone={handleDone} />}

      {/* Form or generate button */}
      {!newToken && (
        showForm ? (
          <NewKeyForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer border border-dashed"
            style={{
              borderColor: 'var(--border-card)',
              color: 'var(--color-sage)',
              backgroundColor: 'transparent',
            }}
          >
            + Generate New Key
          </button>
        )
      )}

      {/* Keys list */}
      {loading ? (
        <KeyListSkeleton />
      ) : keys.length === 0 ? (
        <EmptyState
          icon={
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          }
          title="No API keys yet"
          description="Generate a token to access your health data from external apps and scripts."
          action={{ label: 'Generate New Key', onClick: () => setShowForm(true) }}
        />
      ) : (
        <div className="space-y-3">
          {activeKeys.map((k) => (
            <ApiKeyRow key={k.id} apiKey={k} onRevoke={revokeKey} />
          ))}

          {inactiveKeys.length > 0 && (
            <>
              {activeKeys.length > 0 && (
                <p className="text-xs pt-2 pb-1 font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                  Revoked / Expired
                </p>
              )}
              {inactiveKeys.map((k) => (
                <ApiKeyRow key={k.id} apiKey={k} onRevoke={revokeKey} />
              ))}
            </>
          )}
        </div>
      )}

      {/* How to use */}
      <HowToUseSection />
    </div>
  );
}
