import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInteractionAlerts } from './useInteractionAlerts';
const profile = vi.hoisted(() => ({
  dependentId: null as string | null,
  delegateOwnerId: null as string | null,
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => profile }));
const fetchMock = vi.fn();
const empty = { alerts: [], status: null, snoozed_count: 0 };
function payload(id: string) {
  return {
    alerts: [{ id, alert_text: id }],
    status: { has_interactions: true, checked_at: '2026-10-10' },
    snoozed_count: 0,
  };
}
function ok(data: unknown) {
  return { ok: true, json: async () => data };
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
  fetchMock.mockReset().mockResolvedValue(ok(empty));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('interaction profile lifecycle', () => {
  it('sends explicit self/dependent scope and accepts only matching responses', async () => {
    const { result, rerender } = renderHook(useInteractionAlerts);
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock
      .mockResolvedValueOnce(ok({ dependent_id: null, has_interactions: false }))
      .mockResolvedValueOnce(ok(empty));
    await act(async () => {
      expect(await result.current.checkInteractions()).toEqual({ hasInteractions: false });
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ dependent_id: null });
    profile.dependentId = 'child';
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock
      .mockResolvedValueOnce(ok({ dependent_id: 'child', has_interactions: false }))
      .mockResolvedValueOnce(ok(empty));
    await act(async () => {
      await result.current.checkInteractions('child-med');
    });
    expect(JSON.parse(fetchMock.mock.calls.at(-2)![1].body)).toEqual({
      dependent_id: 'child',
      trigger_id: 'child-med',
    });
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/interaction-alerts?dependent_id=child');
  });
  it('hides prior data immediately and ignores a late initial load from another profile', async () => {
    const late = deferred<ReturnType<typeof ok>>();
    fetchMock.mockReturnValueOnce(late.promise);
    const { result, rerender } = renderHook(useInteractionAlerts);
    profile.dependentId = 'child';
    fetchMock.mockResolvedValueOnce(ok(payload('child-alert')));
    rerender();
    expect(result.current.alerts).toEqual([]);
    await waitFor(() => expect(result.current.alerts[0]?.id).toBe('child-alert'));
    await act(async () => {
      late.resolve(ok(payload('owner-alert')));
    });
    expect(result.current.alerts[0]?.id).toBe('child-alert');
  });
  it('does not restore old data if a request completes after A -> B -> A', async () => {
    fetchMock.mockResolvedValueOnce(ok(payload('original-owner')));
    const { result, rerender } = renderHook(useInteractionAlerts);
    await waitFor(() => expect(result.current.alerts[0]?.id).toBe('original-owner'));
    const late = deferred<ReturnType<typeof ok>>();
    fetchMock.mockReturnValueOnce(late.promise);
    let pending!: ReturnType<typeof result.current.checkInteractions>;
    act(() => {
      pending = result.current.checkInteractions();
    });
    profile.dependentId = 'child';
    fetchMock.mockResolvedValueOnce(ok(payload('child')));
    rerender();
    await waitFor(() => expect(result.current.alerts[0]?.id).toBe('child'));
    profile.dependentId = null;
    fetchMock.mockResolvedValueOnce(ok(payload('new-owner')));
    rerender();
    await waitFor(() => expect(result.current.alerts[0]?.id).toBe('new-owner'));
    await act(async () => {
      late.resolve(ok({ dependent_id: null, has_interactions: false }));
      expect(await pending).toBeNull();
    });
    expect(result.current.alerts[0]?.id).toBe('new-owner');
    expect(result.current.checking).toBe(false);
  });
  it('ignores a status refresh that resolves after switching profiles', async () => {
    const { result, rerender } = renderHook(useInteractionAlerts);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const late = deferred<ReturnType<typeof ok>>();
    fetchMock
      .mockResolvedValueOnce(ok({ dependent_id: null, has_interactions: true }))
      .mockReturnValueOnce(late.promise);
    let pending!: ReturnType<typeof result.current.checkInteractions>;
    act(() => {
      pending = result.current.checkInteractions();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    profile.dependentId = 'child';
    fetchMock.mockResolvedValueOnce(ok(payload('child')));
    rerender();
    await waitFor(() => expect(result.current.alerts[0]?.id).toBe('child'));
    await act(async () => {
      late.resolve(ok(payload('old-owner')));
      await pending;
    });
    expect(result.current.alerts[0]?.id).toBe('child');
  });
  it('does not check delegates or retain the prior profile data in delegate mode', async () => {
    fetchMock.mockResolvedValueOnce(ok(payload('owner')));
    const { result, rerender } = renderHook(useInteractionAlerts);
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    profile.delegateOwnerId = 'other-owner';
    rerender();
    expect(result.current.alerts).toEqual([]);
    expect(result.current.status).toBeNull();
    expect(result.current.canCheck).toBe(false);
    await act(async () => {
      expect(await result.current.checkInteractions()).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('fails closed on a response with missing or different profile association', async () => {
    const { result } = renderHook(useInteractionAlerts);
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const response of [
      { has_interactions: false },
      { dependent_id: 'other', has_interactions: false },
    ]) {
      fetchMock.mockResolvedValueOnce(ok(response));
      await act(async () => {
        expect(await result.current.checkInteractions()).toBeNull();
      });
      expect(result.current.status).toBeNull();
      expect(result.current.error).toBe('Failed to check interactions');
    }
  });
  it('does not let a late snooze failure overwrite another profile', async () => {
    fetchMock.mockResolvedValueOnce(ok(payload('owner')));
    const { result, rerender } = renderHook(useInteractionAlerts);
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    const late = deferred<{ ok: boolean }>();
    fetchMock.mockReturnValueOnce(late.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.snoozeAlert('owner', 1);
    });
    profile.dependentId = 'child';
    fetchMock.mockResolvedValueOnce(ok(payload('child')));
    rerender();
    await waitFor(() => expect(result.current.alerts[0]?.id).toBe('child'));
    await act(async () => {
      late.resolve({ ok: false });
      await pending;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.snoozedCount).toBe(0);
    expect(result.current.alerts[0]?.id).toBe('child');
  });
  it('rejects old callbacks invoked after a profile switch or A -> B -> A', async () => {
    const { result, rerender } = renderHook(useInteractionAlerts);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const oldCheck = result.current.checkInteractions;
    const oldSnooze = result.current.snoozeAlert;
    for (const id of ['child', null]) {
      profile.dependentId = id;
      rerender();
      await waitFor(() => expect(result.current.loading).toBe(false));
      const count = fetchMock.mock.calls.length;
      await act(async () => {
        expect(await oldCheck('owner-med')).toBeNull();
        await oldSnooze('owner-alert', 1);
      });
      expect(fetchMock).toHaveBeenCalledTimes(count);
      expect(result.current.alerts).toEqual([]);
      expect(result.current.snoozedCount).toBe(0);
    }
  });
});
