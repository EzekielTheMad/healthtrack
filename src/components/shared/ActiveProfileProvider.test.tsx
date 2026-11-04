// @vitest-environment-options {"url":"https://synthetic.invalid"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ActiveProfileProvider,
  activeProfileStorageKey,
  useActiveProfile,
} from './ActiveProfileProvider';

const auth = vi.hoisted(() => ({
  data: { user: { id: 'actor' } } as { user: { id: string }; session?: { id: string } } | null,
  isPending: false,
}));
vi.mock('@/lib/auth/client', () => ({ useSession: () => auth, authClient: { signOut: vi.fn() } }));
const seen: string[] = [];
function Records() {
  const selection = useActiveProfile();
  const text = `${selection.dependentId ?? selection.delegateOwnerId ?? 'self'}:${selection.dependentName ?? selection.delegateOwnerName ?? ''}:${selection.delegatePermission ?? ''}`;
  seen.push(text);
  return (
    <>
      <p data-testid="records">{text}</p>
      <button onClick={() => selection.setActiveProfile('child', 'Selected child')}>
        Choose child
      </button>
      <button onClick={() => selection.setActiveProfile(null, null)}>Choose self</button>
    </>
  );
}
const view = () =>
  render(
    <ActiveProfileProvider>
      <Records />
    </ActiveProfileProvider>
  );
const saved = (kind = 'dependent', id = 'child', actor = 'actor') =>
  sessionStorage.setItem(activeProfileStorageKey(actor), JSON.stringify({ version: 1, kind, id }));
const response = (items: unknown[]) => ({ ok: true, json: async () => items });
beforeEach(() => {
  auth.data = { user: { id: 'actor' } };
  auth.isPending = false;
  sessionStorage.clear();
  window.history.replaceState(null, '', '/labs');
  seen.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('selected person restoration', () => {
  it('starts at self without a stored choice and makes no person request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    view();
    expect(await screen.findByTestId('records')).toHaveTextContent('self:');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('remembers only an account-scoped ID and revalidates the child before a reload renders records', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response([{ id: 'child', name: 'Fresh child name' }]))
    );
    const first = view();
    await screen.findByTestId('records');
    fireEvent.click(screen.getByText('Choose child'));
    expect(JSON.parse(sessionStorage.getItem(activeProfileStorageKey('actor'))!)).toEqual({
      version: 1,
      kind: 'dependent',
      id: 'child',
    });
    first.unmount();
    seen.length = 0;
    view();
    expect(screen.queryByTestId('records')).toBeNull();
    expect(await screen.findByTestId('records')).toHaveTextContent('child:Fresh child name:');
    expect(seen.every((value) => value.startsWith('child:'))).toBe(true);
  });
  it('blocks record rendering while authorization is still pending', async () => {
    saved();
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      )
    );
    view();
    await waitFor(() => expect(resolve).toBeDefined());
    expect(screen.queryByTestId('records')).toBeNull();
    await act(async () => resolve(response([{ id: 'child', name: 'Verified child' }])));
    expect(await screen.findByTestId('records')).toHaveTextContent('child:Verified child');
    expect(seen.some((value) => value.startsWith('self:'))).toBe(false);
  });
  it.each(['missing', 'denied', 'malformed'])(
    'does not silently switch an invalid saved person to self: %s',
    async (failure) => {
      saved();
      if (failure === 'malformed')
        sessionStorage.setItem(activeProfileStorageKey('actor'), '{broken');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(failure === 'denied' ? { ok: false } : response([]))
      );
      view();
      await screen.findByRole('alert');
      expect(screen.queryByTestId('records')).toBeNull();
      fireEvent.click(screen.getByText('Use My Health'));
      expect(await screen.findByTestId('records')).toHaveTextContent('self:');
      expect(sessionStorage.getItem(activeProfileStorageKey('actor'))).toBeNull();
    }
  );
  it('retries an unavailable person without discarding the intended choice', async () => {
    saved();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce(response([{ id: 'child', name: 'Child' }]))
    );
    view();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByText('Try again'));
    expect(await screen.findByTestId('records')).toHaveTextContent('child:Child');
  });
  it('uses fresh accepted delegation permissions rather than cached names or access', async () => {
    saved('owner', 'adult');
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response([
          {
            owner_id: 'adult',
            owner_display_name: 'Fresh adult',
            status: 'accepted',
            permission_level: 'read_only',
            expires_at: null,
          },
        ])
      );
    vi.stubGlobal('fetch', fetcher);
    view();
    expect(await screen.findByTestId('records')).toHaveTextContent('adult:Fresh adult:read_only');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/delegates?type=received',
      expect.objectContaining({ cache: 'no-store' })
    );
  });
  it('rejects expired delegation without displaying records', async () => {
    saved('owner', 'adult');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          response([{ owner_id: 'adult', status: 'accepted', expires_at: '2000-01-01T00:00:00Z' }])
        )
    );
    view();
    await screen.findByRole('alert');
    expect(screen.queryByTestId('records')).toBeNull();
  });
  it('isolates account storage and ignores a late response from the previous actor', async () => {
    saved();
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      )
    );
    const rendered = view();
    await waitFor(() => expect(resolve).toBeDefined());
    auth.data = { user: { id: 'different-actor' } };
    rendered.rerender(
      <ActiveProfileProvider>
        <Records />
      </ActiveProfileProvider>
    );
    expect(screen.queryByTestId('records')).toBeNull();
    expect(await screen.findByTestId('records')).toHaveTextContent('self:');
    await act(async () => resolve(response([{ id: 'child', name: 'Old account child' }])));
    expect(screen.getByTestId('records')).toHaveTextContent('self:');
    expect(seen.some((value) => value.includes('Old account'))).toBe(false);
  });
  it('defers explicit handoff context to the browser subject gate instead of restoring an old choice', async () => {
    saved();
    window.history.replaceState(null, '', '/labs?browser_subject=self&account_id=actor');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    view();
    expect(await screen.findByTestId('records')).toHaveTextContent('self:');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires an explicit choice when storage cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    view();
    await screen.findByRole('alert');
    expect(screen.queryByTestId('records')).toBeNull();
    fireEvent.click(screen.getByText('Use My Health'));
    expect(await screen.findByTestId('records')).toHaveTextContent('self:');
  });
  it('keeps the selected person and warns when a browser cannot remember it', async () => {
    view();
    await screen.findByTestId('records');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    fireEvent.click(screen.getByText('Choose child'));
    expect(screen.getByTestId('records')).toHaveTextContent('child:Selected child');
    expect(screen.getByRole('status')).toHaveTextContent('could not remember');
  });
  it('gates records on logout and revalidates the same account before re-login renders its saved selection', async () => {
    saved();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([{ id: 'child', name: 'Old child' }]))
      .mockResolvedValueOnce(response([]));
    vi.stubGlobal('fetch', fetcher);
    const rendered = view();
    expect(await screen.findByTestId('records')).toHaveTextContent('child:Old child');
    auth.data = null;
    rendered.rerender(
      <ActiveProfileProvider>
        <Records />
      </ActiveProfileProvider>
    );
    expect(screen.queryByTestId('records')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('session has expired');
    seen.length = 0;
    auth.data = { user: { id: 'actor' } };
    rendered.rerender(
      <ActiveProfileProvider>
        <Records />
      </ActiveProfileProvider>
    );
    expect(screen.queryByTestId('records')).toBeNull();
    await screen.findByRole('alert');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([]);
  });
  it('revalidates a changed session for the same account without an intervening logout render', async () => {
    auth.data = { user: { id: 'actor' }, session: { id: 'first' } };
    saved();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response([{ id: 'child', name: 'Old child' }]))
      .mockResolvedValueOnce(response([]));
    vi.stubGlobal('fetch', fetcher);
    const rendered = view();
    await screen.findByTestId('records');
    seen.length = 0;
    auth.data = { user: { id: 'actor' }, session: { id: 'second' } };
    rendered.rerender(
      <ActiveProfileProvider>
        <Records />
      </ActiveProfileProvider>
    );
    expect(screen.queryByTestId('records')).toBeNull();
    await screen.findByRole('alert');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([]);
  });
  it('updates a pinned handoff after a manual choice so reload cannot restore the prior person', async () => {
    window.history.replaceState(
      null,
      '',
      '/labs?app=android&browser_subject=dependent&account_id=actor&dependent_id=prior-child'
    );
    view();
    await screen.findByTestId('records');
    fireEvent.click(screen.getByText('Choose child'));
    const params = new URLSearchParams(window.location.search);
    expect(params.get('dependent_id')).toBe('child');
    expect(params.get('browser_subject')).toBe('dependent');
    expect(params.get('account_id')).toBe('actor');
    expect(params.get('app')).toBe('android');
    fireEvent.click(screen.getByText('Choose self'));
    expect(new URLSearchParams(window.location.search).get('browser_subject')).toBe('self');
    expect(new URLSearchParams(window.location.search).has('dependent_id')).toBe(false);
  });
});
