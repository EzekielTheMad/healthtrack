import type { IntegrationHealth } from './status';

export const integrationLabels: Record<string, string> = {
  ok: 'Up to date',
  partial: 'Partial sync',
  failed: 'Sync failed',
  backoff: 'Rate limited',
  reconnect_required: 'Reconnect required',
  never_verified: 'No verified sync yet',
  upstream_unknown: 'Upstream status unknown',
  receiving: 'Phone contact received',
  waiting: 'Waiting for phone contact',
  not_connected: 'Not connected',
  not_configured: 'Instance setup required',
  syncing: 'Syncing',
  inventory: 'Review received applications',
  paused: 'Paused',
  delivery_error: 'Delivery needs attention',
  stale: 'Sync overdue',
  disconnected: 'Disconnected',
};

export function integrationLink(source: string) {
  const anchor = ['oura', 'health_connect', 'renpho', 'myair'].includes(source)
    ? source.replace('_', '-')
    : 'integration-health';
  return `/settings?tab=integrations#${anchor}`;
}

export function needsIntegrationAttention(item: IntegrationHealth) {
  if (item.status === 'not_configured' && !item.connectionStatus) return false;
  return [
    'reconnect_required',
    'failed',
    'partial',
    'stale',
    'delivery_error',
    'not_configured',
  ].includes(item.status);
}

export function integrationWarning(item: IntegrationHealth) {
  if (item.status === 'reconnect_required') return `${item.label} needs reconnection.`;
  if (item.status === 'not_configured') return `${item.label} needs instance configuration.`;
  if (item.status === 'partial') return `${item.label} could not retrieve all data collections.`;
  if (item.status === 'stale') return `${item.label} sync is overdue.`;
  return `${item.label} needs attention.`;
}

export function exactIntegrationTime(value: string | null | undefined, timeZone = 'Etc/UTC') {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return `${date.toLocaleString(undefined, { timeZone })} (${timeZone})`;
}

export function relativeIntegrationTime(value: string | null | undefined, now = Date.now()) {
  if (!value) return 'Unknown';
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return 'Unknown';
  const minutes = Math.floor((now - millis) / 60_000);
  if (minutes < 0) return 'Scheduled';
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}
