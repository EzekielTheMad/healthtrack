import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOffline } from './useOffline';

vi.mock('@/lib/offline/queue', () => ({
  getQueueLength: async () => 0,
  enqueueAction: vi.fn(),
  dequeueActions: async () => [],
}));
afterEach(() => vi.restoreAllMocks());

describe('browser connectivity subscription', () => {
  it('does not replay quarantined writes after reconnect or a manual request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const hook = renderHook(() => useOffline());
    await act(async () => { await hook.result.current.syncNow(); window.dispatchEvent(new Event('online')); });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(hook.result.current.enqueue()).rejects.toThrow(/Reconnect/);
    hook.unmount(); vi.unstubAllGlobals();
  });
  it('reads an initially offline browser and updates on native connectivity events', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const hook = renderHook(() => useOffline());
    expect(hook.result.current.isOnline).toBe(false);
    await act(async () => {
      online.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(hook.result.current.isOnline).toBe(true);
    await act(async () => {
      online.mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(hook.result.current.isOnline).toBe(false);
    hook.unmount();
  });
});
