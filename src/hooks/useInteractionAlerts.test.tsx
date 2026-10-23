import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useInteractionAlerts } from './useInteractionAlerts';

const { profile } = vi.hoisted(() => ({
  profile: { dependentId: null as string | null, delegateOwnerId: null as string | null },
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => profile }));
beforeEach(() => {
  profile.dependentId = null;
  profile.delegateOwnerId = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const payload = (id: string) => ({
  alerts: [{ id, alert_text: `${id} warning` }],
  status: { checked_at: '2026-01-01T12:00:00Z', has_interactions: true },
  snoozed_count: 0,
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('interaction hook scope and freshness', () => {
  it('sends the selected child and retains previous warnings with no clean status after failure', async () => {
    profile.dependentId = 'child-one';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(payload('child')))
      .mockResolvedValueOnce(response({ message: 'Check temporarily unavailable' }, 503));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useInteractionAlerts());
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    await act(async () => {
      await result.current.checkInteractions('child-med');
    });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      dependent_id: 'child-one',
      trigger_id: 'child-med',
      medication_ids: ['child-med'],
    });
    expect(result.current.status).toBeNull();
    expect(result.current.alerts[0].id).toBe('child');
    expect(result.current.error).toBe('Check temporarily unavailable');
  });

  it('never applies a previous patient response after switching profiles', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(payload('owner')))
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        })
      )
      .mockResolvedValueOnce(response(payload('child')));
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender } = renderHook(() => useInteractionAlerts());
    await waitFor(() => expect(result.current.alerts[0]?.id).toBe('owner'));
    let pending!: ReturnType<typeof result.current.checkInteractions>;
    act(() => {
      pending = result.current.checkInteractions();
    });
    profile.dependentId = 'child-one';
    rerender();
    expect(result.current.alerts).toEqual([]);
    await waitFor(() => expect(result.current.alerts[0]?.id).toBe('child'));
    await act(async () => {
      resolve(response({ has_interactions: false }));
      await pending;
    });
    expect(result.current.alerts[0].id).toBe('child');
    expect(result.current.status?.has_interactions).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
