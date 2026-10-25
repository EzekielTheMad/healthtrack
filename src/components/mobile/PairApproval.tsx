'use client';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth/client';
type PairRequest = {
  request_id: string;
  status: string;
  expires_at: string;
  server_url: string;
  account: { id: string; name: string; email: string };
  device: { name: string };
  legacy_delivery_active: boolean;
  active_device: { id: string; name: string } | null;
  subjects: { id: string; name: string; kind: 'owner' | 'dependent' }[];
};
async function readError(res: Response) {
  const data = await res.json().catch(() => null);
  return data?.message ?? data?.error ?? `Request failed (${res.status}).`;
}
export default function PairApproval({ requestId }: { requestId: string }) {
  const { data: session, isPending } = useSession();
  if (isPending) return <p role="status">Verifying account…</p>;
  if (!session?.user.id) return <p role="alert">Sign in again to approve this phone.</p>;
  return <PairApprovalContent key={`${session.user.id}:${requestId}`} requestId={requestId} />;
}
function PairApprovalContent({ requestId }: { requestId: string }) {
  const [request, setRequest] = useState<PairRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!request) return;
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(2_147_483_647, Math.max(1, Date.parse(request.expires_at) - Date.now()))
    );
    return () => window.clearTimeout(timeout);
  }, [request]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/mobile/pairing/${encodeURIComponent(requestId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        const body = (await res.json()) as PairRequest;
        if (!controller.signal.aborted) setRequest(body);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : 'Could not load phone request.');
      });
    return () => controller.abort();
  }, [requestId]);
  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mobile/pairing/${encodeURIComponent(requestId)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_existing: replace, offline_subjects: selected }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setApproved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve phone.');
    } finally {
      setBusy(false);
    }
  }
  if (approved)
    return (
      <div role="status" className="space-y-3">
        <h1 className="text-2xl font-bold">Phone approved</h1>
        <p>
          Return to HealthTrack on Android to finish pairing and choose Health Connect permissions.
          No credentials are shared through this browser page.
        </p>
      </div>
    );
  if (!request)
    return error ? <p role="alert">{error}</p> : <p role="status">Loading phone request…</p>;
  const needsReplace = request.legacy_delivery_active || !!request.active_device;
  const expired = Date.parse(request.expires_at) <= now;
  const pending = request.status === 'pending' && !expired;
  return (
    <div className="max-w-xl space-y-5">
      <h1 className="text-2xl font-bold">Pair Android phone</h1>
      <dl
        className="rounded-xl border p-4 space-y-3 break-words"
        style={{ borderColor: 'var(--border-card)' }}
      >
        <div>
          <dt className="text-sm">Server</dt>
          <dd className="font-medium">{request.server_url}</dd>
        </div>
        <div>
          <dt className="text-sm">Account</dt>
          <dd>
            {request.account.name} · {request.account.email}
          </dd>
        </div>
        <div>
          <dt className="text-sm">Phone</dt>
          <dd>{request.device.name}</dd>
        </div>
        <div>
          <dt className="text-sm">Expires</dt>
          <dd>{new Date(request.expires_at).toLocaleString()}</dd>
        </div>
      </dl>
      <p>
        This phone may deliver the Health Connect categories you approve to your account. Viewing a
        dependent in the website never redirects phone measurements to them.
      </p>
      {needsReplace && (
        <label
          className="flex min-h-11 items-start gap-3 rounded-xl border p-4"
          style={{ borderColor: 'var(--border-card)' }}
        >
          <input
            type="checkbox"
            className="mt-1 size-5 shrink-0"
            checked={replace}
            onChange={(event) => setReplace(event.target.checked)}
          />
          <span>
            Replace {request.active_device?.name ?? 'the Life Dashboard relay'} as the active Health
            Connect sender. Existing records remain. You can explicitly return to legacy delivery
            later.
          </span>
        </label>
      )}
      <fieldset className="space-y-2">
        <legend className="font-semibold mb-2">Optional offline Doctor Essentials access</legend>
        <p className="text-sm">
          Choose whose summaries this phone may save. Saving a copy in the Android app is a separate
          action and requires device authentication.
        </p>
        {request.subjects.map((subject) => (
          <label key={subject.id} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={selected.includes(subject.id)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, subject.id]
                    : current.filter((id) => id !== subject.id)
                )
              }
            />
            {subject.name}
            {subject.kind === 'owner' ? ' (you)' : ''}
          </label>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {!pending && (
        <p role="alert">
          This request is {expired ? 'expired' : request.status}. Start pairing again on your phone.
        </p>
      )}
      <button
        type="button"
        disabled={busy || !pending || (needsReplace && !replace)}
        className="min-h-11 rounded-lg px-4 py-3 font-medium disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-sage)', color: 'var(--color-bark)' }}
        onClick={approve}
      >
        {busy ? 'Approving…' : 'Approve this phone'}
      </button>
    </div>
  );
}
