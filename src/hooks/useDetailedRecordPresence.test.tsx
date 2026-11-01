import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
const { api, selected } = vi.hoisted(() => ({
  api: vi.fn(),
  selected: { dependentId: null as string | null, delegateOwnerId: null as string | null },
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: api }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => selected }));
import { useDetailedRecordPresence } from './useDetailedRecordPresence';
const present = (url: string) =>
  url.startsWith('/api/scans')
    ? { scans: [{ id: 'accepted-scan' }] }
    : {
        records: [
          {
            id: 'accepted-clinical',
            fact: { status: 'unconfirmed', outcome: { kind: 'text', text: 'Negative' } },
          },
        ],
      };
const empty = (url: string) => (url.startsWith('/api/scans') ? { scans: [] } : { records: [] });
beforeEach(() => {
  api.mockReset();
  selected.dependentId = null;
  selected.delegateOwnerId = null;
});
afterEach(() => cleanup());
it('recognizes recorded qualitative/unconfirmed courses and scan history through three bounded kind-specific reads', async () => {
  api.mockImplementation(async (url: string) => present(url));
  const { result } = renderHook(() => useDetailedRecordPresence());
  expect(result.current.loading).toBe(true);
  await waitFor(() =>
    expect(result.current).toMatchObject({
      labs: 'present',
      medications: 'present',
      scans: 'present',
      loading: false,
      unavailable: false,
    })
  );
  expect(api).toHaveBeenCalledTimes(3);
  const urls = api.mock.calls.map(([url]) => new URL(url, 'http://localhost'));
  expect(
    urls.map((url) => [url.pathname, url.searchParams.get('kind'), url.searchParams.get('limit')])
  ).toEqual([
    ['/api/clinical-records', 'lab', '1'],
    ['/api/clinical-records', 'medication', '1'],
    ['/api/scans', null, '1'],
  ]);
});
it('scopes all delegated reads to the selected owner and never retries against the actor on denial', async () => {
  selected.delegateOwnerId = 'shared owner';
  api.mockRejectedValue(new Error('Not found'));
  const { result } = renderHook(() => useDetailedRecordPresence());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current).toMatchObject({
    labs: 'unavailable',
    medications: 'unavailable',
    scans: 'unavailable',
    unavailable: true,
  });
  expect(api).toHaveBeenCalledTimes(3);
  for (const [url] of api.mock.calls) {
    const params = new URL(url, 'http://localhost').searchParams;
    expect(params.get('owner_id')).toBe('shared owner');
    expect(params.get('dependent_id')).toBeNull();
  }
});
it('does not treat malformed or failed domains as empty while preserving independent successes', async () => {
  api.mockImplementation(async (url: string) =>
    url.includes('kind=lab')
      ? { records: 'invalid' }
      : url.includes('kind=medication')
        ? Promise.reject(new Error('Permission denied'))
        : empty(url)
  );
  const { result } = renderHook(() => useDetailedRecordPresence());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current).toMatchObject({
    labs: 'unavailable',
    medications: 'unavailable',
    scans: 'empty',
    unavailable: true,
  });
});
it('hides old-profile presence on the first new-profile render and ignores late old responses', async () => {
  let finish: (value: unknown) => void = () => {};
  api.mockImplementation((url: string) => {
    const params = new URL(url, 'http://localhost').searchParams;
    if (params.has('dependent_id')) return Promise.resolve(empty(url));
    if (params.get('kind') === 'medication')
      return new Promise((resolve) => {
        finish = resolve;
      });
    return Promise.resolve(present(url));
  });
  const { result, rerender } = renderHook(() => useDetailedRecordPresence());
  await waitFor(() => expect(result.current.labs).toBe('present'));
  expect(result.current.medications).toBe('loading');
  selected.dependentId = 'fictional child';
  rerender();
  expect(result.current).toMatchObject({
    labs: 'loading',
    medications: 'loading',
    scans: 'loading',
  });
  await waitFor(() =>
    expect(result.current).toMatchObject({
      labs: 'empty',
      medications: 'empty',
      scans: 'empty',
      loading: false,
    })
  );
  await act(async () => {
    finish({ records: [{ id: 'late-owner-record' }] });
  });
  expect(result.current).toMatchObject({ labs: 'empty', medications: 'empty', scans: 'empty' });
  const childCalls = api.mock.calls.slice(3);
  expect(childCalls).toHaveLength(3);
  for (const [url] of childCalls)
    expect(new URL(url, 'http://localhost').searchParams.get('dependent_id')).toBe(
      'fictional child'
    );
  for (const [, init] of api.mock.calls.slice(0, 3)) expect(init.signal.aborted).toBe(true);
});
