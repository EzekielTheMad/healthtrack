import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHealthQuery } from './useHealthQuery';
const state = vi.hoisted(() => ({
  owner: 'owner',
  dependent: null as string | null,
  delegate: null as string | null,
}));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => ({ data: { user: { id: state.owner } } }),
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => ({ dependentId: state.dependent, delegateOwnerId: state.delegate }),
}));
const fetchMock = vi.fn();
beforeEach(() => {
  state.owner = 'owner';
  state.dependent = null;
  state.delegate = null;
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function entry(subject: string | null = null) {
  return {
    id: 'answer',
    user_id: 'owner',
    dependent_id: subject,
    query_text: 'Q',
    response_text: 'Fictional A',
    created_at: '2026-10-29',
  };
}
describe('query client request lifetimes', () => {
  it('passes the selected dependent and reporting window and checks response identity', async () => {
    state.dependent = 'child';
    const { result } = renderHook(() => useHealthQuery());
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => entry('child') });
    await act(async () => {
      await result.current.submitQuery('Q');
    });
    expect(result.current.queryHistory).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toMatchObject({
      dependent_id: 'child',
      days: 90,
    });
  });
  it('discards an A → B → A response and retained old callbacks', async () => {
    const { result, rerender } = renderHook(() => useHealthQuery());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let finish!: (v: unknown) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        })
    );
    const oldCallback = result.current.submitQuery;
    let pending!: Promise<unknown>;
    act(() => {
      pending = oldCallback('Q');
    });
    state.dependent = 'child';
    rerender();
    state.dependent = null;
    rerender();
    await act(async () => {
      finish({ ok: true, json: async () => entry() });
      await pending;
    });
    expect(result.current.queryHistory).toHaveLength(0);
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      expect(await oldCallback('Old')).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
  it('session changes hide prior owner history and reject foreign response rows', async () => {
    const { result, rerender } = renderHook(() => useHealthQuery());
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => entry() });
    await act(async () => {
      await result.current.submitQuery('Q');
    });
    expect(result.current.queryHistory).toHaveLength(1);
    state.owner = 'other';
    rerender();
    expect(result.current.queryHistory).toHaveLength(0);
  });
  it('does not issue a query from delegate mode', async () => {
    state.delegate = 'other';
    const { result } = renderHook(() => useHealthQuery());
    await act(async () => {
      expect(await result.current.submitQuery('Q')).toBeNull();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
