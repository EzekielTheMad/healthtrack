import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import IntegrationOverview from './IntegrationOverview';
import IntegrationWarning from '@/components/shared/IntegrationWarning';
import { ouraCallbackNotice } from '@/lib/integrations/oura-callback-notice';
import type { IntegrationHealth } from '@/lib/integrations/status';

const mocks = vi.hoisted(() => ({
  integrations: [] as IntegrationHealth[],
  refresh: vi.fn(),
  api: vi.fn(),
  dependentId: null as string | null,
  delegateOwnerId: null as string | null,
  error: null as string | null,
  loading: false,
}));
vi.mock('@/hooks/useIntegrationHealth', () => ({
  useIntegrationHealth: () => ({
    integrations: mocks.integrations,
    error: mocks.error,
    loading: mocks.loading,
    lastCheckedAt: null,
    refresh: mocks.refresh,
  }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('./HealthConnectManager', () => ({ default: () => <div>Phone setup controls</div> }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.api }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => ({
    dependentId: mocks.dependentId,
    delegateOwnerId: mocks.delegateOwnerId,
  }),
}));

const integration = (overrides: Partial<IntegrationHealth> = {}): IntegrationHealth => ({
  source: 'oura',
  label: 'Oura Ring',
  mode: 'pull',
  status: 'partial',
  connectionStatus: 'active',
  lastAttemptAt: '2026-10-23T12:00:00Z',
  lastSuccessAt: null,
  lastReceivedAt: null,
  latestMeasurementAt: null,
  lastNormalizedAt: null,
  errorCode: 'provider_unavailable',
  nextRetryAt: null,
  canSyncNow: true,
  ...overrides,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.integrations = [];
  mocks.dependentId = null;
  mocks.delegateOwnerId = null;
  mocks.error = null;
  mocks.loading = false;
  mocks.refresh.mockResolvedValue(undefined);
});

describe('unified integration controls', () => {
  it('offers permission review without disconnecting usable Oura feeds', () => {
    mocks.integrations = [integration({ errorCode: 'insufficient_scope' })];
    const view = render(<IntegrationOverview />);
    expect(screen.getByText(/Authorization:/)).toHaveTextContent('Connected');
    expect(screen.getByText(/Resilience requires Oura/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review Oura permissions' })).toHaveAttribute(
      'href',
      '/api/oura/start'
    );
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: 'Reconnect Oura' })).not.toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalled();
    mocks.error = 'Unavailable';
    view.rerender(<IntegrationOverview />);
    expect(screen.queryByRole('link', { name: 'Review Oura permissions' })).not.toBeInTheDocument();
  });

  it('keeps native sync on one Oura card and never implies bridge health', async () => {
    mocks.integrations = [
      integration(),
      integration({ source: 'myair', mode: 'push', status: 'upstream_unknown', canSyncNow: false }),
    ];
    mocks.api.mockResolvedValue({ synced: 1, outcome: 'partial', errors: ['unavailable'] });
    render(<IntegrationOverview />);
    expect(screen.getByText('Partial sync')).toBeInTheDocument();
    expect(screen.getByText('Upstream status unknown')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sync now' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith('/api/sync-oura', { method: 'POST' })
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Some Oura collections')
    );
    expect(mocks.refresh).toHaveBeenCalledWith(true);
  });

  it('offers reconnect beside expired status and links the warning to that same card', () => {
    mocks.integrations = [
      integration({ status: 'reconnect_required', connectionStatus: 'expired', canSyncNow: false }),
    ];
    const view = render(
      <>
        <IntegrationOverview />
        <IntegrationWarning />
      </>
    );
    expect(screen.getByRole('link', { name: 'Reconnect Oura' })).toHaveAttribute(
      'href',
      '/api/oura/start'
    );
    expect(screen.getByRole('link', { name: 'Review Oura Ring' })).toHaveAttribute(
      'href',
      '/settings?tab=integrations#oura'
    );
    mocks.dependentId = 'child';
    view.rerender(<IntegrationWarning />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    mocks.dependentId = null;
    mocks.delegateOwnerId = 'adult';
    view.rerender(<IntegrationWarning />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not offer Connect from an unavailable snapshot or a missing instance configuration', () => {
    mocks.integrations = [
      integration({ status: 'not_connected', connectionStatus: null, canSyncNow: false }),
    ];
    mocks.error = 'Could not load integration status';
    const view = render(<IntegrationOverview />);
    expect(screen.queryByRole('link', { name: 'Connect Oura' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry status check' })).toBeInTheDocument();
    mocks.error = null;
    mocks.integrations = [integration({ status: 'not_configured', canSyncNow: false })];
    view.rerender(<IntegrationOverview />);
    expect(screen.queryByRole('link', { name: /connect Oura/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask the instance administrator/)).toBeInTheDocument();
  });

  it('keeps backoff informational and blocks sync', () => {
    mocks.integrations = [
      integration({ status: 'backoff', nextRetryAt: '2099-01-01T01:00:00Z', canSyncNow: false }),
    ];
    render(
      <>
        <IntegrationOverview />
        <IntegrationWarning />
      </>
    );
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(/Retry allowed after/)).toBeInTheDocument();
  });

  it('requires confirmation for disconnect and retains imported records in the explanation', async () => {
    mocks.integrations = [integration()];
    mocks.api.mockResolvedValue({ success: true });
    render(<IntegrationOverview />);
    fireEvent.click(screen.getByText('Manage Oura'));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Oura' }));
    expect(mocks.api).not.toHaveBeenCalled();
    expect(screen.getByText(/Imported health records will remain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith('/api/oura/disconnect', { method: 'POST' })
    );
  });

  it('shows contact, imports and nutrition dates separately for Health Connect', () => {
    mocks.integrations = [
      integration({
        source: 'health_connect',
        mode: 'push',
        status: 'receiving',
        latestNutritionDate: '2026-10-22',
        lastRecordedImportAt: null,
      }),
    ];
    render(<IntegrationOverview />);
    const card = document.getElementById('health-connect')!;
    expect(within(card).getByText('Last accepted phone contact')).toBeInTheDocument();
    expect(within(card).getByText('Latest recorded data import')).toBeInTheDocument();
    expect(within(card).getByText('2026-10-22')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });
});

describe('Oura callback notices', () => {
  it.each(['success', 'empty', 'partial', 'failed'])(
    'states completed initial outcome %s without claiming it is still syncing',
    (outcome) => {
      const notice = ouraCallbackNotice(
        new URLSearchParams({ oura: 'connected', initial_sync: outcome })
      );
      expect(notice).toContain('authorization saved');
      expect(notice).not.toContain('Syncing');
    }
  );
  it('does not reflect arbitrary provider error text', () => {
    expect(
      ouraCallbackNotice(new URLSearchParams({ oura: 'error', reason: 'sensitive upstream text' }))
    ).not.toContain('sensitive');
  });
  it.each(['__proto__', 'constructor', 'toString'])(
    'handles reserved callback key %s safely',
    (key) => {
      expect(typeof ouraCallbackNotice(new URLSearchParams({ oura: 'error', reason: key }))).toBe(
        'string'
      );
      expect(
        typeof ouraCallbackNotice(new URLSearchParams({ oura: 'connected', initial_sync: key }))
      ).toBe('string');
    }
  );
});
