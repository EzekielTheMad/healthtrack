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
