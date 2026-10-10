import { StrictMode, useLayoutEffect } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHealthQuery } from './useHealthQuery';

const profile = vi.hoisted(() => ({
  dependentId: null as string | null,
  delegateOwnerId: null as string | null,
}));
const auth = vi.hoisted(() => ({ userId: 'owner' as string | null, loading: false }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => profile }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: auth.userId ? { id: auth.userId } : null, loading: auth.loading }),
}));
const CONTEXT = { ownerId: 'owner', dependentId: null, contextVersion: 1 };
const fetchMock = vi.fn();
function entry(id = 'answer', extra: Record<string, unknown> = {}) {
  return {
    id,
    user_id: 'owner',
    dependent_id: null,
    context_version: 1,
    query_text: 'Synthetic question',
    response_text: `Synthetic answer ${id}`,
    created_at: '2026-10-10T00:00:00Z',
    ...extra,
  };
}
function result(id = 'answer', extra: Record<string, unknown> = {}) {
  return { ...entry(id), context: CONTEXT, ...extra };
}
function ok(data: unknown) {
  return { ok: true, json: vi.fn(async () => data) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  profile.dependentId = null;
  profile.delegateOwnerId = null;
  auth.userId = 'owner';
  auth.loading = false;
  fetchMock.mockReset().mockResolvedValue(ok([]));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ready() {
  const hook = renderHook(() => useHealthQuery());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('useHealthQuery owner context', () => {
  it.each(['dependentId', 'delegateOwnerId'] as const)(
    'does not fetch, generate, refresh, or expose history for %s',
    async (field) => {
      profile[field] = 'other';
      const { result } = renderHook(() => useHealthQuery());
      expect(result.current.canQuery).toBe(false);
      expect(result.current.queryHistory).toEqual([]);
      expect(result.current.loading).toBe(false);
      await act(async () => {
        expect(await result.current.submitQuery('Synthetic question')).toBeNull();
        expect(await result.current.refreshLast()).toBeNull();
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('waits for authentication and AI readiness', async () => {
    auth.loading = true;
    const { result, rerender } = renderHook(({ enabled }) => useHealthQuery(enabled), {
      initialProps: { enabled: true },
    });
    await act(async () => {
      await result.current.submitQuery('Synthetic question');
    });
    expect(fetchMock).not.toHaveBeenCalled();
    auth.loading = false;
    auth.userId = null;
    rerender({ enabled: true });
    expect(fetchMock).not.toHaveBeenCalled();
    auth.userId = 'owner';
    rerender({ enabled: false });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('requests explicit self and dedupes only current-version owner history', async () => {
    fetchMock.mockResolvedValueOnce(
      ok([
        entry('legacy', { context_version: 0 }),
        entry('unversioned', { context_version: undefined }),
        entry('child', { dependent_id: 'child' }),
        entry('unscoped', { dependent_id: undefined }),
        entry('other-owner', { user_id: 'other-owner' }),
        entry('current'),
      ])
    );
    const { result } = await ready();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/query-history?dependent_id=self');
    expect(result.current.queryHistory.map((e) => e.id)).toEqual(['current']);
    await act(async () => {
      expect((await result.current.submitQuery(' SYNTHETIC QUESTION '))?.id).toBe('current');
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.current.notice).toContain('saved answer');
    fetchMock.mockResolvedValueOnce(ok(resultPayload()));
    await act(async () => {
      await result.current.refreshLast();
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      query: 'SYNTHETIC QUESTION',
      dependent_id: 'self',
    });
    expect(result.current.notice).toBeNull();
  });

  it('does not dedupe legacy answers even if their text matches', async () => {
    fetchMock.mockResolvedValueOnce(ok([entry('legacy', { context_version: 0 })]));
    const { result } = await ready();
    fetchMock.mockResolvedValueOnce(ok(resultPayload()));
    await act(async () => {
      expect((await result.current.submitQuery('Synthetic question'))?.id).toBe('answer');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.queryHistory.map((e) => e.id)).toEqual(['answer']);
  });

  it.each([
    { context: undefined },
    { context: { ...CONTEXT, ownerId: 'other-owner' } },
    { context: { ...CONTEXT, dependentId: 'child' } },
    { context: { ...CONTEXT, contextVersion: 0 } },
    { context_version: 0 },
    { user_id: 'other-owner' },
    { dependent_id: 'child' },
    { dependent_id: undefined },
  ])('rejects mismatched response metadata %j', async (extra) => {
    const { result } = await ready();
    fetchMock.mockResolvedValueOnce(ok(resultPayload('bad', extra)));
    await act(async () => {
      expect(await result.current.submitQuery('Synthetic question')).toBeNull();
    });
    expect(result.current.queryHistory).toEqual([]);
    expect(result.current.error).toContain('unexpected profile context');
    expect(result.current.submitting).toBe(false);
  });

  it('hides loaded data during the first render of a profile change, before passive effects', async () => {
    const snapshots: unknown[] = [];
    fetchMock.mockResolvedValueOnce(ok([entry('initial')]));
    const { result, rerender } = renderHook(() => {
      const query = useHealthQuery();
      useLayoutEffect(() => {
        snapshots.push(query.queryHistory.map((e) => e.id));
      });
      return query;
    });
    await waitFor(() => expect(result.current.queryHistory).toHaveLength(1));
    profile.dependentId = 'child';
    rerender();
    expect(snapshots.at(-1)).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.notice).toBeNull();
  });

  it('rejects retained submit and refresh callbacks after self → other → self', async () => {
    fetchMock.mockResolvedValueOnce(ok([entry('initial')]));
    const { result, rerender } = await ready();
    await act(async () => {
      await result.current.submitQuery('Synthetic question');
    });
    const oldSubmit = result.current.submitQuery;
    const oldRefresh = result.current.refreshLast;
    for (const dependentId of ['child', null]) {
      profile.dependentId = dependentId;
      rerender();
      await waitFor(() => expect(result.current.loading).toBe(false));
      const count = fetchMock.mock.calls.length;
      await act(async () => {
        expect(await oldSubmit('Synthetic question', { force: true })).toBeNull();
        expect(await oldRefresh()).toBeNull();
        expect(await result.current.refreshLast()).toBeNull();
      });
      expect(fetchMock).toHaveBeenCalledTimes(count);
      expect(result.current.queryHistory).toEqual([]);
      expect(result.current.notice).toBeNull();
    }
  });

  it.each(['fetch', 'json'] as const)(
    'ignores late history across %s boundary and self → other → self',
    async (stage) => {
      const late = deferred<unknown>();
      const oldResponse = ok([entry('old')]);
      fetchMock.mockReturnValueOnce(
        stage === 'fetch'
          ? late.promise
          : Promise.resolve({
              ok: true,
              json: () => late.promise,
            })
      );
      const { result, rerender } = renderHook(() => useHealthQuery());
      await act(async () => {});
      profile.delegateOwnerId = 'other';
      rerender();
      expect(result.current.queryHistory).toEqual([]);
      profile.delegateOwnerId = null;
      fetchMock.mockResolvedValueOnce(ok([entry('current')]));
      rerender();
      await waitFor(() => expect(result.current.queryHistory[0]?.id).toBe('current'));
      await act(async () => {
        late.resolve(stage === 'fetch' ? oldResponse : [entry('old')]);
      });
      expect(result.current.queryHistory.map((e) => e.id)).toEqual(['current']);
      if (stage === 'fetch') expect(oldResponse.json).not.toHaveBeenCalled();
    }
  );

  it.each(['fetch', 'json'] as const)(
    'ignores late query across %s boundary without overwriting new busy/error state',
    async (stage) => {
      const { result, rerender } = await ready();
      const late = deferred<unknown>();
      const oldResponse = ok(resultPayload('old'));
      fetchMock.mockReturnValueOnce(
        stage === 'fetch'
          ? late.promise
          : Promise.resolve({
              ok: true,
              json: () => late.promise,
            })
      );
      let pending!: ReturnType<typeof result.current.submitQuery>;
      act(() => {
        pending = result.current.submitQuery('Old synthetic question');
      });
      await act(async () => {});
      profile.dependentId = 'child';
      rerender();
      expect(result.current.submitting).toBe(false);
      profile.dependentId = null;
      rerender();
      await waitFor(() => expect(result.current.loading).toBe(false));
      const fresh = deferred<ReturnType<typeof ok>>();
      fetchMock.mockReturnValueOnce(fresh.promise);
      let next!: ReturnType<typeof result.current.submitQuery>;
      act(() => {
        next = result.current.submitQuery('New synthetic question');
      });
      await act(async () => {
        late.resolve(stage === 'fetch' ? oldResponse : resultPayload('old'));
        expect(await pending).toBeNull();
      });
      expect(result.current.submitting).toBe(true);
      expect(result.current.queryHistory).toEqual([]);
      expect(result.current.error).toBeNull();
      if (stage === 'fetch') expect(oldResponse.json).not.toHaveBeenCalled();
      await act(async () => {
        fresh.resolve(ok(resultPayload('fresh')));
        await next;
      });
      expect(result.current.queryHistory.map((e) => e.id)).toEqual(['fresh']);
    }
  );

  it('ignores late failure bodies after changing authenticated owners', async () => {
    const { result, rerender } = await ready();
    const late = deferred<unknown>();
    fetchMock.mockResolvedValueOnce({ ok: false, json: () => late.promise });
    let pending!: ReturnType<typeof result.current.submitQuery>;
    act(() => {
      pending = result.current.submitQuery('Synthetic question');
    });
    await act(async () => {});
    auth.userId = 'next-owner';
    fetchMock.mockResolvedValueOnce(ok([entry('next', { user_id: 'next-owner' })]));
    rerender();
    await waitFor(() => expect(result.current.queryHistory[0]?.id).toBe('next'));
    await act(async () => {
      late.resolve({ message: 'Old owner failure' });
      await pending;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.submitting).toBe(false);
  });

  it('invalidates Strict Mode replay requests and callbacks after unmount', async () => {
    const late = deferred<ReturnType<typeof ok>>();
    fetchMock.mockReturnValueOnce(late.promise).mockResolvedValueOnce(ok([entry('active')]));
    const { result, unmount } = renderHook(() => useHealthQuery(), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.queryHistory[0]?.id).toBe('active'));
    const oldResponse = ok([entry('replayed')]);
    await act(async () => {
      late.resolve(oldResponse);
    });
    expect(oldResponse.json).not.toHaveBeenCalled();
    expect(result.current.queryHistory[0]?.id).toBe('active');
    const submit = result.current.submitQuery;
    unmount();
    const count = fetchMock.mock.calls.length;
    expect(await submit('Synthetic question')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });
});

// Distinct name avoids shadowing renderHook's result variable in tests.
const resultPayload = result;
