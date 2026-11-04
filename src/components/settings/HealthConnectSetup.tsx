'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';

const subscribe = () => () => {};
const style = { backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' };
interface Props {
  active: boolean;
  hasContact: boolean;
  hasRecords: boolean;
  newlyCreated: boolean;
  busy: boolean;
  writesDisabled?: boolean;
  refreshing: boolean;
  tokenReveal: ReactNode;
  secretReveal: ReactNode;
  hasToken: boolean;
  onCreateToken: () => void;
  onRefresh: () => void;
}

/** Credentials stay with the mounted manager; this panel never persists or broadcasts them. */
export default function HealthConnectSetup(props: Props) {
  const [tokenChoice, setExistingToken] = useState<boolean | null>(null);
  const existingToken = tokenChoice ?? !props.newlyCreated;
  const origin = useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => ''
  );
  const credentials = (
    <div className="space-y-3 pt-2">
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        The Life Dashboard Android companion needs an Authorization token and an HMAC signing
        secret.
      </p>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">Phone delivery token</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="hc-token-choice"
            checked={existingToken}
            onChange={() => setExistingToken(true)}
          />
          Use an existing delivery token
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="hc-token-choice"
            checked={!existingToken}
            onChange={() => setExistingToken(false)}
          />
          Create a dedicated phone token
        </label>
      </fieldset>
      {existingToken ? (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Use a token with <code>write:health_connect</code> on the phone. You do not need to enter
          it here.
        </p>
      ) : (
        !props.hasToken && (
          <button
            type="button"
            disabled={props.busy || props.refreshing || props.writesDisabled}
            onClick={props.onCreateToken}
            className="min-h-11 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            style={style}
          >
            Create delivery token
          </button>
        )
      )}
      {props.tokenReveal}
      {props.secretReveal || (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          The signing secret was shown once at creation. Keep the saved value already on your phone.
          If it is lost, explicitly rotate it under Advanced controls.
        </p>
      )}
      <dl className="text-xs space-y-2">
        <div>
          <dt className="font-medium">Webhook URL</dt>
          <dd className="font-mono break-all">
            {origin || 'Your HealthTrack address'}/api/v1/integrations/health-connect/webhook
          </dd>
        </div>
        <div>
          <dt className="font-medium">Header name</dt>
          <dd className="font-mono">Authorization</dd>
        </div>
        <div>
          <dt className="font-medium">Header value</dt>
          <dd className="font-mono">Bearer &lt;your delivery token&gt;</dd>
        </div>
        <div>
          <dt className="font-medium">Signing secret</dt>
          <dd>Use the HMAC secret above or the saved secret on your phone.</dd>
        </div>
        <div>
          <dt className="font-medium">Companion options</dt>
          <dd>Daily totals enabled · MQTT disabled</dd>
        </div>
      </dl>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        New tokens created here grant only <code>write:health_connect</code>. Manage other tokens in{' '}
        <Link href="/settings?tab=advanced#api-access" className="underline">
          Advanced → API Access
        </Link>
        . Keep these values on this device; Settings tab changes preserve the reveal, but a reload
        does not.
      </p>
    </div>
  );
  return (
    <div className="space-y-4 min-w-0">
      {props.active ? (
        <details
          open={Boolean(props.secretReveal) || Boolean(props.tokenReveal)}
          className="rounded-lg border p-4"
          style={style}
        >
          <summary className="text-sm font-medium cursor-pointer">
            Phone connection and credentials
          </summary>
          {credentials}
        </details>
      ) : (
        <section className="rounded-lg border p-4 space-y-2" style={style}>
          <h4 className="text-sm font-semibold">1. Configure phone credentials</h4>
          {credentials}
        </section>
      )}
      {!props.active && (
        <section className="rounded-lg border p-4 space-y-2" style={style}>
          <h4 className="text-sm font-semibold">2. Verify phone contact</h4>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            On the phone, choose <strong>Send Test Ping</strong>, then check contact here. Next, run
            a sync to send records.
          </p>
          <p className="text-sm">
            {props.hasContact ? 'Phone contact verified' : 'Awaiting first phone contact'}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {props.hasRecords
              ? 'Health records have been received for review.'
              : 'No health records received yet. Run a sync on the phone to populate inventory.'}{' '}
            A test ping verifies delivery only; it does not mean health data has synced.
          </p>
          <button
            type="button"
            disabled={props.busy || props.refreshing}
            onClick={props.onRefresh}
            className="min-h-11 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            style={style}
          >
            {props.refreshing ? 'Checking phone contact…' : 'Check phone contact'}
          </button>
        </section>
      )}
    </div>
  );
}
