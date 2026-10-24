'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useOura } from '@/hooks/useOura';
import { useIntegrationHealth } from '@/hooks/useIntegrationHealth';
import { ouraErrorMessage } from '@/lib/oura/errors';
import { ouraCallbackNotice } from '@/lib/integrations/oura-callback-notice';
import { integrationLabels } from '@/lib/integrations/presentation';
import { IntegrationTime } from './IntegrationTime';

const buttonClass =
  'min-h-11 px-4 py-2 rounded-lg border text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';

export function OuraConnectCard() {
  const { state, busy, error: actionError, result, sync, disconnect } = useOura();
  const { error, refresh } = useIntegrationHealth();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const params = useSearchParams();
  const router = useRouter();
  const [notice, setNotice] = useState(() => ouraCallbackNotice(params));

  useEffect(() => {
    if (!params.get('oura')) return;
    const url = new URL(window.location.href);
    ['oura', 'reason', 'initial_sync'].forEach((key) => url.searchParams.delete(key));
    url.searchParams.set('tab', 'integrations');
    if (!url.hash) url.hash = 'oura';
    router.replace(url.pathname + url.search + url.hash, { scroll: false });
  }, [params, router]);

  if (!state) return null;
  const connected = state.connectionStatus === 'active';
  const canConnect = ['not_connected', 'disconnected', 'reconnect_required'].includes(state.status);
  const reconnect = state.status === 'reconnect_required';

  return (
    <article
      id="oura"
      className="rounded-xl border p-4 sm:p-5 space-y-4 scroll-mt-6"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 tabIndex={-1} data-settings-focus className="text-base font-semibold">
            Oura Ring
          </h3>
          <p className="text-sm text-[var(--color-text-muted)]">
            Sleep, activity, recovery, heart rate and SpO₂
          </p>
        </div>
        <span className="text-sm font-medium">
          {error ? 'Status unavailable' : (integrationLabels[state.status] ?? state.status)}
        </span>
      </div>
      {notice && (
        <div role="status" className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <p className="flex-1">{notice}</p>
          <button
            type="button"
            className="min-h-11 min-w-11 underline"
            aria-label="Dismiss Oura notice"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      <p className="text-sm">
        Authorization:{' '}
        {state.connectionStatus === 'expired'
          ? 'Expired — reconnect to resume sync'
          : connected
            ? 'Connected'
            : state.status === 'not_configured'
              ? 'Instance setup required'
              : 'Not connected'}
      </p>
      {state.errorCode && !error && (
        <p className="text-sm text-[var(--color-warning)]">{ouraErrorMessage(state.errorCode)}</p>
      )}
      <dl className="grid gap-2 sm:grid-cols-2 text-sm">
        <div>
          <dt className="text-[var(--color-text-muted)]">Last full sync</dt>
          <dd>
            <IntegrationTime value={state.lastSuccessAt} timeZone={state.timeZone} />
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-muted)]">Latest measurement date</dt>
          <dd>{state.latestMeasurementAt?.slice(0, 10) ?? 'Unknown'}</dd>
        </div>
      </dl>
      {state.status === 'not_configured' && (
        <p className="text-sm">
          Ask the instance administrator to configure OURA_CLIENT_ID and OURA_CLIENT_SECRET, then
          reload this page.
        </p>
      )}
      {state.status === 'backoff' && (
        <p className="text-sm">
          Retry allowed after{' '}
          <IntegrationTime value={state.nextRetryAt} timeZone={state.timeZone} exact />.{' '}
          {state.nextScheduledAt
            ? 'Automatic sync will retry.'
            : 'No automatic sync is scheduled; retry manually after this time.'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {error ? (
          <button className={buttonClass} onClick={() => void refresh(true)}>
            Retry status check
          </button>
        ) : canConnect ? (
          <a className={buttonClass} href="/api/oura/start">
            {reconnect ? 'Reconnect Oura' : 'Connect Oura'}
          </a>
        ) : (
          state.status !== 'not_configured' && (
            <button
              type="button"
              className={buttonClass}
              disabled={!state.canSyncNow || !!busy}
              onClick={() => void sync()}
            >
              {busy === 'sync' || state.status === 'syncing' ? 'Syncing…' : 'Sync now'}
            </button>
          )
        )}
      </div>
      {canConnect && (
        <p className="text-xs text-[var(--color-text-muted)]">
          After authorization, HealthTrack imports up to 30 days before returning here.
        </p>
      )}
      {(actionError || result) && (
        <p role={actionError ? 'alert' : 'status'} className="text-sm">
          {actionError ?? result}
        </p>
      )}
      <details className="border-t pt-3" style={{ borderColor: 'var(--border-card)' }}>
        <summary className="cursor-pointer min-h-11 py-2 text-sm font-medium">Manage Oura</summary>
        <dl className="space-y-2 text-xs mb-4">
          <div>
            <dt>Last attempt</dt>
            <dd>
              <IntegrationTime value={state.lastAttemptAt} timeZone={state.timeZone} exact />
            </dd>
          </div>
          <div>
            <dt>Last received measurement</dt>
            <dd>
              <IntegrationTime value={state.lastReceivedAt} timeZone={state.timeZone} exact />
            </dd>
          </div>
          <div>
            <dt>Next scheduled check</dt>
            <dd>
              {state.nextScheduledAt ? (
                <IntegrationTime value={state.nextScheduledAt} timeZone={state.timeZone} exact />
              ) : (
                'No automatic check scheduled'
              )}
            </dd>
          </div>
        </dl>
        {state.connectionStatus &&
          state.connectionStatus !== 'disconnected' &&
          state.status !== 'not_configured' &&
          (!confirmDisconnect ? (
            <button
              type="button"
              className={buttonClass}
              disabled={!!busy || !!error}
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect Oura
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">
                Disconnect Oura? Imported health records will remain in HealthTrack.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={!!busy || !!error}
                  onClick={async () => {
                    if (await disconnect()) setConfirmDisconnect(false);
                  }}
                >
                  {busy === 'disconnect' ? 'Disconnecting…' : 'Confirm disconnect'}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={!!busy}
                  onClick={() => setConfirmDisconnect(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
      </details>
    </article>
  );
}
