import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IntegrationOverview from './IntegrationOverview';
import IntegrationWarning from '@/components/shared/IntegrationWarning';
import type { IntegrationHealth } from '@/lib/integrations/status';

const mocks = vi.hoisted(() => ({
  integrations: [] as IntegrationHealth[],
  refresh: vi.fn(),
  api: vi.fn(),
  dependentId: null as string | null,
}));
vi.mock('@/hooks/useIntegrationHealth', () => ({
  useIntegrationHealth: () => ({
    integrations: mocks.integrations,
    error: null,
    refresh: mocks.refresh,
  }),
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.api }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => ({ dependentId: mocks.dependentId, delegateOwnerId: null }),
}));

const integration = (overrides: Partial<IntegrationHealth>): IntegrationHealth => ({
  source: 'oura',
  label: 'Oura Ring',
  mode: 'pull',
  status: 'partial',
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
  mocks.refresh.mockResolvedValue(undefined);
});

describe('integration health controls and warnings', () => {
  it('keeps manual sync native and displays push receipts without an upstream health claim', async () => {
    mocks.integrations = [
      integration({}),
      integration({
        source: 'myair',
        label: 'myair',
        mode: 'push',
        status: 'upstream_unknown',
        canSyncNow: false,
        errorCode: null,
      }),
    ];
    mocks.api.mockResolvedValue({ errors: ['Sleep: provider unavailable'] });
    render(<IntegrationOverview />);
    expect(screen.getByText('Partial sync')).toBeInTheDocument();
    expect(screen.getByText('External feed · upstream status unknown')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sync Now' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith('/api/sync-oura', { method: 'POST' })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Sleep: provider unavailable')
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it('warns about expired authorization and links to Settings, while respecting the active profile', () => {
    mocks.integrations = [integration({ status: 'reconnect_required', canSyncNow: false })];
    const view = render(<IntegrationWarning />);
    expect(screen.getByRole('status')).toHaveTextContent('needs authorization');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/settings#integration-health');
    mocks.dependentId = 'fixture-child';
    view.rerender(<IntegrationWarning />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
