import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useHealthConnect } from './useHealthConnect';

const integration = {
  id: 'synthetic-hc',
  name: 'Synthetic phone',
  status: 'inventory',
  allowedSources: {},
  enabledTypes: [],
};
const response = (data: unknown, ok = true) => ({ ok, json: async () => data }) as Response;
const fetcher = vi.fn();
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Health Connect setup requests and refresh', () => {
  it('creates a delivery token only on request with the narrow scope and broadcasts no credentials', async () => {
    fetcher.mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? response({ token: 'synthetic-one-time-pat' })
        : response({ integration })
    );
    const events: unknown[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener('integration-health-changed', listener);
    try {
      const { result } = renderHook(() => useHealthConnect());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(fetcher).toHaveBeenCalledTimes(1);
      let token: string | null = null;
      await act(async () => {
        token = await result.current.createDeliveryToken();
      });
      expect(token).toBe('synthetic-one-time-pat');
      const calls = fetcher.mock.calls.filter(([url]) => url === '/api/api-keys');
      expect(calls).toHaveLength(1);
      expect(JSON.parse(calls[0][1].body)).toEqual({
        name: 'Health Connect phone delivery',
        scopes: ['write:health_connect'],
      });
      expect(events).toEqual([{ source: 'health_connect' }]);
      expect(JSON.stringify(result.current)).not.toContain('synthetic-one-time-pat');
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetcher).toHaveBeenCalledTimes(3); // GET never broadcasts another event.
    } finally {
      window.removeEventListener('integration-health-changed', listener);
    }
  });
  it('refreshes on focus and integration events, and stops listeners after unmount', async () => {
    fetcher.mockResolvedValue(response({ integration }));
    const { result, unmount } = renderHook(() => useHealthConnect());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      window.dispatchEvent(new Event('integration-health-changed'));
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    unmount();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('integration-health-changed'));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('keeps a later snapshot when an earlier request finishes last', async () => {
    let resolveOld!: (value: Response) => void;
    fetcher
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockResolvedValue(response({ integration: { ...integration, status: 'active' } }));
    const { result } = renderHook(() => useHealthConnect());
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await waitFor(() => expect(result.current.integration?.status).toBe('active'));
    await act(async () => {
      resolveOld(response({ integration }));
    });
    expect(result.current.integration?.status).toBe('active');
  });
  it('aborts a pending read on unmount without starting another request', async () => {
    fetcher.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useHealthConnect());
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds status reads and permits explicit recovery without retrying automatically', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    fetcher.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        })
    );
    const { result } = renderHook(() => useHealthConnect());
    expect(timeout).toHaveBeenCalledWith(10_000);
    await act(async () => deadline.abort(new DOMException('Synthetic timeout', 'TimeoutError')));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readError).toContain('timed out');
    expect(result.current.actionError).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    timeout.mockRestore();
    fetcher.mockResolvedValue(response({ integration }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.readError).toBeNull();
    expect(result.current.integration?.id).toBe(integration.id);
  });
  it('blocks every management write while the snapshot is unavailable and keeps action errors independent', async () => {
    fetcher.mockResolvedValueOnce(response({ integration }));
    const { result } = renderHook(() => useHealthConnect());
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetcher.mockResolvedValueOnce(response({ error: 'Synthetic write failed' }, false));
    await act(async () => {
      await result.current.update({ status: 'active' });
    });
    expect(result.current.actionError).toBe('Synthetic write failed');
    expect(result.current.readError).toBeNull();
    fetcher.mockRejectedValueOnce(new Error('Synthetic status unavailable'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.readError).toBe('Synthetic status unavailable');
    expect(result.current.actionError).toBe('Synthetic write failed');
    const count = fetcher.mock.calls.length;
    await act(async () => {
      expect(await result.current.create()).toBeNull();
      expect(await result.current.createDeliveryToken()).toBeNull();
      expect(await result.current.update({ status: 'active' })).toBe(false);
      expect(await result.current.rotate()).toBeNull();
      expect(await result.current.remove(false)).toBe(false);
      expect(await result.current.reprocessNutrition()).toBeNull();
    });
    expect(fetcher).toHaveBeenCalledTimes(count);
    fetcher.mockResolvedValue(response({ integration }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.readError).toBeNull();
    expect(result.current.actionError).toBe('Synthetic write failed');
  });
  it('refreshes after successful configuration and does not expose a returned HMAC in shared state', async () => {
    fetcher.mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? response({ integration, secret: 'synthetic-hmac' })
        : response({ integration })
    );
    const { result } = renderHook(() => useHealthConnect());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let secret: string | null = null;
    await act(async () => {
      secret = await result.current.create();
    });
    expect(secret).toBe('synthetic-hmac');
    expect(JSON.stringify(result.current)).not.toContain('synthetic-hmac');
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  });
});
