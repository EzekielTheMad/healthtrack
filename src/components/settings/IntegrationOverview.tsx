'use client';

import { useState } from 'react';
import { useIntegrationHealth } from '@/hooks/useIntegrationHealth';
import { ouraErrorMessage } from '@/lib/oura/errors';
import { apiFetch } from '@/lib/api/client';

const when = (value: string | null) => (value ? new Date(value).toLocaleString() : 'Unknown');
const labels: Record<string, string> = {
  ok: 'OK',
  partial: 'Partial sync',
  failed: 'Sync failed',
  backoff: 'Rate limited',
  reconnect_required: 'Reconnect required',
  never_verified: 'No verified sync yet',
  upstream_unknown: 'External feed · upstream status unknown',
  receiving: 'Receiving deliveries',
  waiting: 'Waiting for first delivery',
  not_connected: 'Not connected',
  not_configured: 'Not configured',
  syncing: 'Syncing',
  inventory: 'Inventory only',
  paused: 'Paused',
  delivery_error: 'Delivery needs attention',
  stale: 'Sync overdue',
  disconnected: 'Disconnected',
};

export default function IntegrationOverview() {
  const { integrations, error, refresh } = useIntegrationHealth();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  return (
    <section
      id="integration-health"
      className="rounded-xl border p-5 space-y-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <div className="flex justify-between items-center gap-3">
        <h2 className="font-semibold">Integration health</h2>
        <button type="button" className="text-sm underline" onClick={() => void refresh()}>
          Refresh status
        </button>
      </div>
      {(error || syncError) && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
          {error ?? syncError}
        </p>
      )}
      {!integrations.length && !error && (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Connect a device or send a bridge delivery to see its status here.
        </p>
      )}
      {integrations.map((item) => (
        <article
          className="border rounded-lg p-3 space-y-2"
          key={item.source}
          style={{ borderColor: 'var(--border-card)' }}
        >
          <div className="flex flex-wrap gap-2 justify-between">
            <h3 className="font-medium text-sm">{item.label}</h3>
            <span className="text-xs">{labels[item.status] ?? item.status}</span>
          </div>
          <dl
            className="grid gap-x-4 gap-y-1 sm:grid-cols-2 text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {item.mode === 'pull' && (
              <>
                <div>
                  <dt className="inline">Last attempt: </dt>
                  <dd className="inline">{when(item.lastAttemptAt)}</dd>
                </div>
                <div>
                  <dt className="inline">Last full success: </dt>
                  <dd className="inline">{when(item.lastSuccessAt)}</dd>
                </div>
              </>
            )}
            <div>
              <dt className="inline">Last received: </dt>
              <dd className="inline">{when(item.lastReceivedAt)}</dd>
            </div>
            <div>
              <dt className="inline">Latest measurement: </dt>
              <dd className="inline">{item.latestMeasurementAt?.slice(0, 10) ?? 'Unknown'}</dd>
            </div>
            {item.source === 'health_connect' && (
              <div>
                <dt className="inline">Last normalization: </dt>
                <dd className="inline">{when(item.lastNormalizedAt)}</dd>
              </div>
            )}
            {item.nextRetryAt && (
              <div>
                <dt className="inline">Retry allowed after: </dt>
                <dd className="inline">{when(item.nextRetryAt)}</dd>
              </div>
            )}
            {item.mode === 'pull' && (
              <div>
                <dt className="inline">Next scheduled check: </dt>
                <dd className="inline">
                  {item.nextScheduledAt
                    ? when(item.nextScheduledAt)
                    : 'No automatic check scheduled'}
                </dd>
              </div>
            )}
          </dl>
          {item.errorCode && (
            <p className="text-xs" style={{ color: 'var(--color-warning)' }}>
              {item.source === 'oura'
                ? ouraErrorMessage(item.errorCode)
                : 'Review the delivery log below for details.'}
            </p>
          )}
          {item.source === 'oura' && item.status === 'reconnect_required' && (
            <a href="/api/oura/start" className="text-sm underline">
              Reconnect Oura
            </a>
          )}
          {item.canSyncNow && (
            <button
              type="button"
              className="text-sm underline"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                setSyncError(null);
                try {
                  const result = await apiFetch<{ errors: string[] }>('/api/sync-oura', {
                    method: 'POST',
                  });
                  if (result.errors.length) setSyncError(result.errors.join('; '));
                } catch {
                  setSyncError('Could not start Oura sync. Refresh status for details.');
                } finally {
                  setSyncing(false);
                  await refresh();
                  window.dispatchEvent(new Event('integration-health-changed'));
                }
              }}
            >
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
          )}
          {item.mode === 'push' && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {item.source === 'health_connect'
                ? 'Start a sync in the companion phone app. Refresh status only checks deliveries already received.'
                : 'This source reports through the API or an import. Its upstream schedule and authorization are not available; received time does not verify that connection.'}
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
