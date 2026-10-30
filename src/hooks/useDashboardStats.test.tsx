import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useDashboardStats } from './useDashboardStats';
import DashboardCustomizer from '@/components/dashboard/DashboardCustomizer';
import { MANUAL_DEFAULTS } from '@/lib/dashboard-metrics';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  profile: { dependentId: null as string | null, delegateOwnerId: null as string | null },
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.api }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => mocks.profile,
}));
afterEach(() => {
  cleanup();
  mocks.profile.dependentId = null;
  mocks.profile.delegateOwnerId = null;
  vi.resetAllMocks();
});

const preference = (id: string, metricKey: string) => ({
  id,
  user_id: 'fixture-owner',
  dependent_id: null,
  widget_type: 'lab_result' as const,
  metric_key: metricKey,
  position: 0,
  pinned: false,
  visible: true,
  created_at: '',
  updated_at: '',
});
const response = (id = 'owner-pref', test = 'Owner-only lab') => ({
  preferences: [preference(id, test)],
  source_count: 1,
  available_lab_tests: [{ test_name: test, unit: 'fixture', latest_value: 123, flag: null }],
});

describe('dashboard preference patient isolation', () => {
  it('uses generic cards and never reads or writes owner preferences while delegated', async () => {
    mocks.profile.delegateOwnerId = 'delegated-owner';
    const { result } = renderHook(() => useDashboardStats());
    expect(result.current.stats.map((stat) => stat.metric_key)).toEqual(MANUAL_DEFAULTS);
    expect(result.current.availableLabTests).toEqual([]);
    expect(result.current.canCustomize).toBe(false);
    expect(result.current.loading).toBe(false);
    await act(async () => {
      await result.current.initializeStats(['weight']);
      await result.current.addStat('lab_result', 'Owner-only lab');
      await result.current.removeStat('owner-pref');
      await result.current.toggleVisibility('owner-pref');
      await result.current.togglePinned('owner-pref');
      await result.current.reorder('owner-pref', 'down');
    });
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('hides owner extras and preferences immediately when switching to a delegated record', async () => {
    mocks.api.mockResolvedValue(response());
    const hook = renderHook(() => useDashboardStats());
    await waitFor(() => expect(hook.result.current.availableLabTests).toHaveLength(1));
    const previousAdd = hook.result.current.addStat;
    mocks.profile.delegateOwnerId = 'delegated-owner';
    hook.rerender();
    expect(hook.result.current.availableLabTests).toEqual([]);
    expect(hook.result.current.stats.map((stat) => stat.metric_key)).toEqual(MANUAL_DEFAULTS);
    expect(hook.result.current.hasCustomized).toBe(false);
    await act(async () => {
      await previousAdd('vital', 'weight');
    });
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it('ignores a late owner mutation after the child preferences have loaded', async () => {
    let resolveMutation!: (rows: unknown) => void;
    mocks.api
      .mockResolvedValueOnce(response())
      .mockReturnValueOnce(
        new Promise((done) => {
          resolveMutation = done;
        })
      )
      .mockResolvedValueOnce(response('child-pref', 'Child lab'));
    const hook = renderHook(() => useDashboardStats());
    await waitFor(() => expect(hook.result.current.availableLabTests).toHaveLength(1));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.addStat('vital', 'weight');
    });
    mocks.profile.dependentId = 'child';
    hook.rerender();
    expect(hook.result.current.availableLabTests).toEqual([]);
    await waitFor(() => expect(hook.result.current.stats[0]?.id).toBe('child-pref'));
    await act(async () => {
      resolveMutation([preference('late-owner', 'Owner-only lab')]);
      await pending;
    });
    expect(hook.result.current.stats.map((stat) => stat.id)).toEqual(['child-pref']);
    expect(mocks.api.mock.calls[2][0]).toBe('/api/dashboard-stats?dependent_id=child');
  });

  it('does not render an already-open personal customizer in delegate mode', () => {
    mocks.profile.delegateOwnerId = 'delegated-owner';
    render(
      <DashboardCustomizer
        stats={[preference('owner-pref', 'Owner-only lab')]}
        availableLabTests={[
          { testName: 'Owner-only lab', unit: 'fixture', latestValue: 123, flag: null },
        ]}
        onAddStat={vi.fn()}
        onRemoveStat={vi.fn()}
        onToggleVisibility={vi.fn()}
        onTogglePinned={vi.fn()}
        onReorder={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText('Owner-only lab')).not.toBeInTheDocument();
    expect(screen.queryByText('Customize Stats')).not.toBeInTheDocument();
  });
});
