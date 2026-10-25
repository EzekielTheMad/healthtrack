'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { nativeActionHref, useAndroidMode } from './AndroidMode';
import { useSession } from '@/lib/auth/client';
type DeviceList = {
  devices: {
    id: string;
    name: string;
    status: string;
    last_sync_at: string | null;
    created_at: string;
    offline_subjects: { id: string; name: string }[];
  }[];
  legacy_delivery_active: boolean;
};
export default function DeviceManager() {
  const { data: session, isPending } = useSession();
  if (isPending) return <p role="status">Verifying account…</p>;
  if (!session?.user.id) return <p role="alert">Sign in again to manage phones.</p>;
  return <AccountDevices key={session.user.id} />;
}
function AccountDevices() {
  const android = useAndroidMode();
  const [data, setData] = useState<DeviceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/mobile/devices', { signal, cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load paired phones.');
      const next = (await res.json()) as DeviceList;
      if (!signal?.aborted) {
        setData(next);
        setError(null);
      }
    } catch (err) {
      if (!signal?.aborted)
        setError(err instanceof Error ? err.message : 'Could not load paired phones.');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // Initialize account-scoped state from the external device API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  async function change(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(
        id === 'legacy'
          ? '/api/mobile/devices/restore-legacy'
          : `/api/mobile/devices/${encodeURIComponent(id)}/revoke`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? body?.error ?? 'Could not update phone access.');
      }
      setConfirm(null);
      await refresh();
      window.dispatchEvent(new Event('integration-health-changed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update phone access.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Phone & sync</h1>
      <p>
        Health Connect synchronization belongs to your paired account. It continues independently of
        the person selected in the website.
      </p>
      <div className="flex flex-wrap gap-2">
        {android && (
          <a
            href={nativeActionHref('sync')}
            className="inline-flex min-h-11 items-center rounded-lg border px-4 py-2"
            style={{ borderColor: 'var(--border-card)' }}
          >
            Open phone sync
          </a>
        )}
        <Link
          href="/settings?tab=integrations#health-connect"
          className="inline-flex min-h-11 items-center rounded-lg border px-4 py-2"
          style={{ borderColor: 'var(--border-card)' }}
        >
          Sources & delivery history
        </Link>
        <button type="button" onClick={() => void refresh()} className="min-h-11 px-4">
          Refresh status
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Loading paired phones…</p>}
      {data && (
        <>
          <p>Legacy relay delivery: {data.legacy_delivery_active ? 'enabled' : 'not active'}.</p>
          {!data.devices.length && (
            <p>
              No phones paired. In the Android app, enter this server’s HTTPS address and choose
              Pair account.
            </p>
          )}
          {data.devices.map((device) => (
            <article
              key={device.id}
              className="rounded-xl border p-4 space-y-3"
              style={{ borderColor: 'var(--border-card)' }}
            >
              <h2 className="font-semibold">{device.name}</h2>
              <p>Status: {device.status}</p>
              <p className="text-sm">
                Last accepted Health Connect delivery:{' '}
                {device.last_sync_at
                  ? new Date(device.last_sync_at).toLocaleString()
                  : 'Not received yet'}
              </p>
              <p className="text-sm">
                Offline summary grants:{' '}
                {device.offline_subjects.map((subject) => subject.name).join(', ') || 'None'}
              </p>
              {device.status === 'active' &&
                (confirm === device.id ? (
                  <div className="space-y-2">
                    <p>
                      Revoke this phone’s credentials and summary grants? An offline phone removes
                      saved copies when it next connects.
                    </p>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => void change(device.id)}
                      className="min-h-11 px-3"
                    >
                      {busy ? 'Revoking…' : 'Confirm revoke'}
                    </button>
                    <button
                      type="button"
                      className="min-h-11 px-3"
                      onClick={() => setConfirm(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirm(device.id)}
                    className="min-h-11 px-3 underline"
                  >
                    Revoke phone
                  </button>
                ))}
            </article>
          ))}
          {!data.legacy_delivery_active && data.devices.length > 0 && (
            <section
              className="rounded-xl border p-4 space-y-2"
              style={{ borderColor: 'var(--border-card)' }}
            >
              <h2 className="font-semibold">Return to Life Dashboard</h2>
              <p className="text-sm">
                Disable native delivery before using the existing legacy relay again. This does not
                remove imported records or rotate shared API tokens.
              </p>
              {confirm === 'legacy' ? (
                <>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void change('legacy')}
                    className="min-h-11 px-3"
                  >
                    Confirm return to legacy delivery
                  </button>
                  <button type="button" className="min-h-11 px-3" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirm('legacy')}
                  className="min-h-11 px-3 underline"
                >
                  Return to legacy delivery
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
