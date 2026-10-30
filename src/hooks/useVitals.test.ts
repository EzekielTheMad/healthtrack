import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useVitals } from './useVitals';
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  profile: { dependentId: null as string | null, delegateOwnerId: null as string | null },
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.api }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => mocks.profile,
}));
afterEach(() => {
  mocks.profile.dependentId = null;
  mocks.profile.delegateOwnerId = null;
  vi.resetAllMocks();
});
const reading = (id: string, source: string) => ({
  id,
  user_id: 'fixture',
  metric_key: 'weight',
  value: 180,
  unit: 'lbs',
  source,
  recorded_at: '2026-10-20T00:00:00Z',
  metadata: {},
  created_at: '2026-10-20T00:00:00Z',
});

describe('vitals source selection and profile transitions', () => {
  it.each(['success', 'failure'] as const)(
    'keeps an in-flight owner save %s out of a newly loaded dependent',
    async (outcome) => {
      let resolveSave!: (value: unknown) => void;
      let rejectSave!: (error: Error) => void;
      const saved = new Promise((resolve, reject) => {
        resolveSave = resolve;
        rejectSave = reject;
      });
      mocks.api.mockImplementation(async (url: string, options?: { method?: string }) => {
        if (options?.method === 'POST') return saved;
        if (url === '/api/vital-source-preferences') return {};
        return url.includes('dependent_id=')
          ? [reading('child', 'manual')]
          : [reading('owner', 'manual')];
      });
      const hook = renderHook(() => useVitals());
      await waitFor(() => expect(hook.result.current.vitals[0]?.id).toBe('owner'));
      let request!: Promise<void>;
      act(() => {
        request = hook.result.current.addVital(reading('owner-new', 'manual'));
      });
      act(() => {
        mocks.profile.dependentId = 'fixture-child';
        hook.rerender();
      });
      await waitFor(() => expect(hook.result.current.vitals[0]?.id).toBe('child'));
      const failure = new Error('owner write failed');
      await act(async () => {
        if (outcome === 'success') {
          resolveSave(reading('owner-new', 'manual'));
          await request;
        } else {
          rejectSave(failure);
          await expect(request).rejects.toBe(failure);
        }
      });
      expect(hook.result.current.rawVitals.map((row) => row.id)).toEqual(['child']);
      expect(hook.result.current.error).toBeNull();
      const post = mocks.api.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(JSON.parse(post![1].body)).not.toHaveProperty('dependent_id');
    }
  );

  it('rejects failed manual writes so callers retain their draft', async () => {
    const failure = new Error('save rejected');
    mocks.api.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (options?.method === 'POST') throw failure;
      return url === '/api/vital-source-preferences' ? {} : [];
    });
    const hook = renderHook(() => useVitals());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const input = reading('new', 'manual');
    await act(async () => {
      await expect(hook.result.current.addVital(input)).rejects.toBe(failure);
    });
    expect(hook.result.current.error).toBe('save rejected');
    expect(hook.result.current.rawVitals).toEqual([]);
  });
  it('persists a choice, re-reads it, and never exposes the previous patient during a profile switch', async () => {
    let preference: Record<string, string> = {};
    let resolveChild!: (rows: unknown[]) => void;
    mocks.api.mockImplementation(
      async (url: string, options?: { method?: string; body?: string }) => {
        if (url === '/api/vital-source-preferences') {
          if (options?.method === 'PATCH') {
            const body = JSON.parse(options.body!);
            preference = { [body.metric_key]: body.preferred_source };
            return { saved: true };
          }
          return preference;
        }
        if (url.includes('dependent_id='))
          return new Promise((done) => {
            resolveChild = done;
          });
        return [reading('a', 'scale-a'), reading('b', 'scale-b')];
      }
    );
    const hook = renderHook(() => useVitals());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.vitals).toEqual([]);
    expect(hook.result.current.sourceConflicts[0].needsChoice).toBe(true);
    await act(() => hook.result.current.chooseSource('weight', 'scale-b'));
    await waitFor(() => expect(hook.result.current.vitals[0]?.id).toBe('b'));
    const callsBeforeChild = mocks.api.mock.calls.filter(
      ([url]) => url === '/api/vital-source-preferences'
    ).length;
    act(() => {
      mocks.profile.dependentId = 'fixture-child';
      hook.rerender();
    });
    expect(hook.result.current.vitals).toEqual([]);
    expect(hook.result.current.rawVitals).toEqual([]);
    expect(hook.result.current.canChooseSource).toBe(false);
    await act(async () => {
      resolveChild([reading('child', 'child-scale')]);
    });
    await waitFor(() => expect(hook.result.current.vitals[0]?.id).toBe('child'));
    expect(
      mocks.api.mock.calls.filter(([url]) => url === '/api/vital-source-preferences')
    ).toHaveLength(callsBeforeChild);
  });
});
