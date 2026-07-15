'use client';

/**
 * Admin-only: create, share, and revoke single-use registration invites.
 * The invite URL is built from window.location.origin so it always matches
 * whatever address the instance is being served on.
 */
import { useCallback, useEffect, useState } from 'react';

interface InviteRow {
  id: string;
  token: string;
  note: string | null;
  expires_at: string;
  used_at: string | null;
  used_email: string | null;
  created_at: string;
}

function inviteUrl(token: string): string {
  return `${window.location.origin}/login?invite=${encodeURIComponent(token)}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function InviteManager() {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/invites');
      if (!res.ok) throw new Error('Failed to load invites');
      setInvites((await res.json()) as InviteRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createInvite = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      if (!res.ok) throw new Error('Failed to create invite');
      setNote('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setBusy(false);
    }
  }, [note, refresh]);

  const revoke = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        await fetch(`/api/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const copy = useCallback(async (row: InviteRow) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(row.token));
      setCopiedId(row.id);
      setTimeout(() => setCopiedId((prev) => (prev === row.id ? null : prev)), 2000);
    } catch {
      // Clipboard unavailable — the link is still visible to copy manually.
    }
  }, []);

  const now = Date.now();
  const pending = invites.filter((i) => !i.used_at && new Date(i.expires_at).getTime() > now);
  const inactive = invites.filter((i) => i.used_at || new Date(i.expires_at).getTime() <= now);

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Registration on this instance is invite-only. Create a single-use link
        (valid 7 days) and send it to the person you want to add. Each link can
        register exactly one account.
      </p>

      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (e.g. who it's for)"
          className="flex-1 min-w-[200px] rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--border-card)',
          }}
        />
        <button
          type="button"
          onClick={createInvite}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-sage)', color: 'var(--color-bark)' }}
        >
          Create invite link
        </button>
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Loading…
        </p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap text-sm"
                  style={{ borderColor: 'var(--border-card)' }}
                >
                  <div className="min-w-0">
                    <span style={{ color: 'var(--color-text-primary)' }}>
                      {row.note || 'Invite link'}
                    </span>
                    <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      expires {fmtDate(row.expires_at)}
                    </span>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => copy(row)}
                      className="text-xs font-medium underline cursor-pointer"
                      style={{ color: 'var(--color-sage)' }}
                    >
                      {copiedId === row.id ? 'Copied!' : 'Copy link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => revoke(row.id)}
                      disabled={busy}
                      className="text-xs font-medium underline cursor-pointer disabled:opacity-50"
                      style={{ color: 'var(--color-terracotta)' }}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {inactive.length > 0 && (
            <div className="space-y-1">
              {inactive.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 text-xs px-3 py-1.5"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <span className="min-w-0 truncate">
                    {row.note || 'Invite'} —{' '}
                    {row.used_at
                      ? `used${row.used_email ? ` by ${row.used_email}` : ''} on ${fmtDate(row.used_at)}`
                      : `expired ${fmtDate(row.expires_at)}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => revoke(row.id)}
                    disabled={busy}
                    className="underline cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {pending.length === 0 && inactive.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              No invites yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}
