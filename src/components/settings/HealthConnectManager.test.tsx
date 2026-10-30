import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import HealthConnectManager from './HealthConnectManager';
import type { HealthConnectIntegration, InventoryEntry, IngestRun } from '@/hooks/useHealthConnect';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  rotate: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  createDeliveryToken: vi.fn(),
  reprocessNutrition: vi.fn(),
}));
let snapshot: {
  integration: HealthConnectIntegration | null;
  inventory: InventoryEntry[];
  runs: IngestRun[];
  loading: boolean;
  error: string | null;
  readError: string | null;
};
vi.mock('@/hooks/useHealthConnect', () => ({
  useHealthConnect: () => ({ ...snapshot, ...mocks, lastBackfill: null, rebuild: null }),
}));
const integration = (extra: Partial<HealthConnectIntegration> = {}): HealthConnectIntegration => ({
  id: 'synthetic-hc',
  name: 'Synthetic phone',
  status: 'inventory',
  allowedSources: {},
  enabledTypes: [],
  nutritionStrategy: 'sum_items',
  lastReceivedAt: null,
  lastNormalizedAt: null,
  lastAppVersion: null,
  lastError: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...extra,
});
const inventory: InventoryEntry = {
  recordType: 'nutrition',
  sourcePackage: 'com.synthetic.food',
  identityKind: 'uuid',
  count: 4,
  oldest: null,
  newest: null,
  lastSeenAt: '2026-01-02',
  populatedFields: ['calories'],
};
beforeEach(() => {
  vi.clearAllMocks();
  snapshot = {
    integration: null,
    inventory: [],
    runs: [],
    loading: false,
    error: null,
    readError: null,
  };
  mocks.create.mockImplementation(async () => {
    snapshot.integration = integration();
    return 'synthetic-signing-secret';
  });
  mocks.createDeliveryToken.mockResolvedValue('synthetic-phone-token');
  mocks.update.mockImplementation(async (patch) => {
    snapshot.integration = {
      ...snapshot.integration!,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.allowed_sources ? { allowedSources: patch.allowed_sources } : {}),
      ...(patch.enabled_types ? { enabledTypes: patch.enabled_types } : {}),
    };
    return true;
  });
  mocks.refresh.mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('guided Health Connect management', () => {
  it('waits for explicit creation and keeps one-time credentials across mounted tab visibility/refresh', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const view = render(
      <div hidden={false}>
        <HealthConnectManager embedded />
      </div>
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Create Health Connect integration/ })).toHaveClass(
      'min-h-11'
    );
    fireEvent.click(screen.getByRole('button', { name: /Create Health Connect integration/ }));
    expect(await screen.findByText('synthetic-signing-secret')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create delivery token' }));
    expect(await screen.findByText('Bearer synthetic-phone-token')).toBeInTheDocument();
    snapshot.loading = true;
    view.rerender(
      <div hidden>
        <HealthConnectManager embedded />
      </div>
    );
    view.rerender(
      <div hidden={false}>
        <HealthConnectManager embedded />
      </div>
    );
    expect(screen.getByText('synthetic-signing-secret')).toBeInTheDocument();
    expect(screen.getByText('Bearer synthetic-phone-token')).toBeInTheDocument();
    expect(local).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Advanced → API Access' })).toHaveAttribute(
      'href',
      '/settings?tab=advanced#api-access'
    );
    expect(
      [...document.querySelectorAll('a')].every(
        (link) => !link.href.includes('synthetic-phone-token')
      )
    ).toBe(true);
  });
  it('supports an existing token without creating or rotating anything', () => {
    snapshot.integration = integration({ status: 'active' });
    render(<HealthConnectManager embedded />);
    expect(screen.getByLabelText('Use an existing delivery token')).toBeChecked();
    expect(mocks.createDeliveryToken).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rotate).not.toHaveBeenCalled();
    expect(screen.queryByText('Synthetic phone')).not.toBeInTheDocument();
  });
  it('reports a test ping as contact, never as records or activation readiness', () => {
    snapshot.integration = integration({
      lastReceivedAt: '2026-01-02',
      enabledTypes: ['daily_totals'],
    });
    snapshot.runs = [
      {
        id: 'ping',
        status: 'test_ping',
        received_count: 0,
        normalization_summary_json: {},
        received_at: '2026-01-02',
      } as IngestRun,
    ];
    render(<HealthConnectManager embedded />);
    expect(screen.getByText('Phone contact verified')).toBeInTheDocument();
    expect(screen.getByText(/No health records received yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate normalization' })).toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('retains delivery diagnostics in embedded management without duplicating its heading', () => {
    snapshot.integration = integration({
      status: 'error',
      lastError: 'Delivery signature rejected.',
    });
    render(<HealthConnectManager embedded />);
    expect(screen.getByRole('alert')).toHaveTextContent('Delivery signature rejected.');
    expect(screen.queryByText('Synthetic phone')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check phone contact' })).toHaveClass('min-h-11');
  });
  it('requires exact package review and explicit type selection before activation', async () => {
    snapshot.integration = integration();
    snapshot.inventory = [inventory];
    render(<HealthConnectManager embedded />);
    expect(screen.getByRole('checkbox', { name: /Nutrition \(MacroFactor\)/ })).toBeDisabled();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Approve com.synthetic.food for nutrition' })
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        allowed_sources: { nutrition: ['com.synthetic.food'] },
      })
    );
    expect(mocks.update).not.toHaveBeenCalledWith({ status: 'active' });
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Nutrition \(MacroFactor\)/ })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Nutrition \(MacroFactor\)/ }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({ enabled_types: ['nutrition'] })
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Activate normalization' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Activate normalization' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ status: 'active' }));
  });
  it('keeps destructive rotation/deletion behind explicit confirmation', async () => {
    snapshot.integration = integration({ status: 'active' });
    render(<HealthConnectManager embedded />);
    fireEvent.click(screen.getByText('Advanced controls'));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete integration' }));
    await act(async () => {});
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.rotate).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('offers retry rather than blind creation when initial loading failed', () => {
    snapshot.readError = 'Status unavailable';
    render(<HealthConnectManager embedded />);
    expect(screen.getByRole('alert')).toHaveTextContent('Status unavailable');
    expect(
      screen.getByRole('button', { name: /Create Health Connect integration/ })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading Health Connect' }));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('refreshes management and then requests a shared status refresh without mutation events', async () => {
    snapshot.integration = integration();
    const status = vi.fn();
    const changed = vi.fn();
    window.addEventListener('integration-status-refresh', status);
    window.addEventListener('integration-health-changed', changed);
    try {
      render(<HealthConnectManager embedded />);
      fireEvent.click(screen.getByRole('button', { name: 'Check phone contact' }));
      await waitFor(() => expect(status).toHaveBeenCalledOnce());
      expect(mocks.refresh).toHaveBeenCalledOnce();
      expect(changed).not.toHaveBeenCalled();
      expect((status.mock.calls[0][0] as CustomEvent).detail).toEqual({ source: 'health_connect' });
    } finally {
      window.removeEventListener('integration-status-refresh', status);
      window.removeEventListener('integration-health-changed', changed);
    }
  });
  it('blocks writes from a stale existing integration while keeping read retry available', () => {
    snapshot.integration = integration({
      status: 'active',
      enabledTypes: ['nutrition'],
      allowedSources: { nutrition: ['com.synthetic.food'] },
    });
    snapshot.inventory = [inventory];
    snapshot.readError = 'Status unavailable';
    render(<HealthConnectManager embedded />);
    expect(screen.getByRole('button', { name: 'Retry loading Health Connect' })).not.toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: 'Approve com.synthetic.food for nutrition' })
    ).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Nutrition \(MacroFactor\)/ })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reprocess retained nutrition' })).toBeDisabled();
    fireEvent.click(screen.getByText('Advanced controls'));
    for (const name of ['Pause deliveries', 'Rotate secret', 'Delete integration'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    fireEvent.click(screen.getByText('Phone connection and credentials'));
    fireEvent.click(screen.getByRole('radio', { name: 'Create a dedicated phone token' }));
    expect(screen.getByRole('button', { name: 'Create delivery token' })).toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createDeliveryToken).not.toHaveBeenCalled();
  });
  it('allows retrying an explicit action after an action-only error', () => {
    snapshot.integration = integration({ enabledTypes: ['daily_totals'] });
    snapshot.inventory = [inventory];
    snapshot.error = 'Synthetic action failed';
    render(<HealthConnectManager embedded />);
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic action failed');
    expect(screen.getByRole('button', { name: 'Activate normalization' })).not.toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
