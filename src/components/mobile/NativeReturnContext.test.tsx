// @vitest-environment-options {"url":"https://synthetic.invalid"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ActiveProfileProvider, useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { AndroidModeProvider, nativeActionHref, useNativeActionHref } from './AndroidMode';
import BrowserSubjectGate from './BrowserSubjectGate';

const auth = vi.hoisted(() => ({
  data: { user: { id: 'owner' } } as { user: { id: string } } | null,
  isPending: false,
}));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => auth,
  authClient: { signOut: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));

function returnUrl(href: string | null) {
  expect(href).not.toBeNull();
  const intent = new URL(href!);
  expect(intent.protocol).toBe('intent:');
  expect(intent.hash).toBe('#Intent;scheme=healthtrack;package=com.omnihealthtracker.app;end');
  expect(intent.searchParams.get('return_origin')).toBe('https://synthetic.invalid');
  return new URL(intent.searchParams.get('return_to')!, 'https://synthetic.invalid');
}

function Records() {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const href = useNativeActionHref('doctor');
  return (
    <>
      <p data-testid="records">{dependentId ?? delegateOwnerId ?? 'self'}</p>
      {href && <a href={href}>Save on this phone</a>}
    </>
  );
}

function view() {
  return render(
    <AndroidModeProvider>
      <ActiveProfileProvider>
        <BrowserSubjectGate>
          <Records />
        </BrowserSubjectGate>
      </ActiveProfileProvider>
    </AndroidModeProvider>
  );
}

beforeEach(() => {
  auth.data = { user: { id: 'owner' } };
  auth.isPending = false;
  sessionStorage.clear();
  window.history.replaceState(null, '', '/mobile/doctor');
});
afterEach(() => vi.unstubAllGlobals());

describe('native return URLs', () => {
  it.each(['sync', 'doctor'] as const)(
    'binds %s to the current account and a fixed route',
    (action) => {
      const url = returnUrl(
        nativeActionHref(action, {
          origin: 'https://synthetic.invalid',
          accountId: 'owner',
          dependentId: null,
          ownerId: null,
        })
      );
      expect(url.pathname).toBe(action === 'sync' ? '/mobile/devices' : '/mobile/doctor');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        app: 'android',
        browser_subject: 'self',
        account_id: 'owner',
      });
    }
  );

  it('retains selected dependent and delegate context without changing phone ownership', () => {
    for (const [dependentId, ownerId, kind, key] of [
      ['child', null, 'dependent', 'dependent_id'],
      [null, 'adult', 'owner', 'owner_id'],
    ] as const) {
      const url = returnUrl(
        nativeActionHref('doctor', {
          origin: 'https://synthetic.invalid',
          accountId: 'owner',
          dependentId,
          ownerId,
        })
      );
      expect(url.searchParams.get('browser_subject')).toBe(kind);
      expect(url.searchParams.get(key)).toBe(dependentId ?? ownerId);
      expect(url.searchParams.get('account_id')).toBe('owner');
      expect([...url.searchParams.keys()]).not.toContain('server');
      expect([...url.searchParams.keys()]).not.toContain('token');
    }
  });

  it.each([
    { accountId: '', dependentId: null, ownerId: null },
    { accountId: 'owner', dependentId: 'child', ownerId: 'adult' },
    { accountId: 'owner&account_id=other', dependentId: null, ownerId: null },
    { accountId: 'owner', dependentId: 'https://other.invalid', ownerId: null },
    { accountId: 'owner', dependentId: null, ownerId: '../other' },
  ])('does not create native navigation for malformed or ambiguous context', (context) => {
    expect(
      nativeActionHref('doctor', { origin: 'https://synthetic.invalid', ...context })
    ).toBeNull();
  });

  it.each([
    'http://synthetic.invalid',
    'https://user:password@synthetic.invalid',
    'https://synthetic.invalid/path',
    'https://synthetic.invalid?next=other',
  ])('rejects invalid instance origin %s', (origin) => {
    expect(
      nativeActionHref('doctor', { origin, accountId: 'owner', dependentId: null, ownerId: null })
    ).toBeNull();
  });

  it('normalizes a default HTTPS port before binding the native instance', () => {
    const href = nativeActionHref('doctor', {
      origin: 'https://synthetic.invalid:443',
      accountId: 'owner',
      dependentId: null,
      ownerId: null,
    });
    expect(new URL(href!).searchParams.get('return_origin')).toBe('https://synthetic.invalid');
  });
});

describe('returning from native screens', () => {
  it('restores a dependent before rendering records and creates the next link from that selection', async () => {
    const url = returnUrl(
      nativeActionHref('doctor', {
        origin: 'https://synthetic.invalid',
        accountId: 'owner',
        dependentId: 'child',
        ownerId: null,
      })
    );
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      )
    );
    view();
    expect(screen.queryByTestId('records')).not.toBeInTheDocument();
    resolve({ ok: true, json: async () => [{ id: 'child', name: 'Synthetic child' }] });
    expect(await screen.findByTestId('records')).toHaveTextContent('child');
    const next = returnUrl(
      screen.getByRole('link', { name: 'Save on this phone' }).getAttribute('href')
    );
    expect(next.searchParams.get('dependent_id')).toBe('child');
    expect(next.searchParams.get('browser_subject')).toBe('dependent');
  });

  it('restores authorized delegated context before rendering records', async () => {
    const url = returnUrl(
      nativeActionHref('sync', {
        origin: 'https://synthetic.invalid',
        accountId: 'owner',
        dependentId: null,
        ownerId: 'adult',
      })
    );
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            owner_id: 'adult',
            status: 'accepted',
            expires_at: '2099-01-01T00:00:00Z',
            owner_display_name: 'Synthetic adult',
            permission_level: 'read',
          },
        ],
      })
    );
    view();
    expect(await screen.findByTestId('records')).toHaveTextContent('adult');
    expect(
      returnUrl(
        screen.getByRole('link', { name: 'Save on this phone' }).getAttribute('href')
      ).searchParams.get('owner_id')
    ).toBe('adult');
  });

  it('rejects a different signed-in account without rendering owner or dependent records', async () => {
    window.history.replaceState(
      null,
      '',
      '/mobile/doctor?app=android&browser_subject=dependent&account_id=owner&dependent_id=child'
    );
    auth.data = { user: { id: 'another-account' } };
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    view();
    expect(await screen.findByRole('alert')).toHaveTextContent('same account');
    expect(screen.queryByTestId('records')).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the requested account and person in sign-in recovery after expiry', () => {
    window.history.replaceState(
      null,
      '',
      '/mobile/doctor?app=android&browser_subject=dependent&account_id=owner&dependent_id=child'
    );
    auth.data = null;
    view();
    expect(screen.getByRole('alert')).toHaveTextContent('session has expired');
    expect(screen.queryByTestId('records')).not.toBeInTheDocument();
    const href = screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')!;
    expect(new URL(href, 'https://synthetic.invalid').searchParams.get('returnTo')).toContain(
      'dependent_id=child'
    );
  });

  it('fails closed when the selected dependent is no longer available', async () => {
    window.history.replaceState(
      null,
      '',
      '/mobile/doctor?app=android&browser_subject=dependent&account_id=owner&dependent_id=child'
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    view();
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
    expect(screen.queryByTestId('records')).not.toBeInTheDocument();
  });

  it('rechecks changed return context instead of reusing the previous checked person', async () => {
    window.history.replaceState(
      null,
      '',
      '/mobile/doctor?app=android&browser_subject=self&account_id=owner'
    );
    const rendered = view();
    expect(await screen.findByTestId('records')).toHaveTextContent('self');
    window.history.replaceState(
      null,
      '',
      '/mobile/doctor?app=android&browser_subject=dependent&account_id=owner&dependent_id=missing-child'
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    rendered.rerender(
      <AndroidModeProvider>
        <ActiveProfileProvider>
          <BrowserSubjectGate>
            <Records />
          </BrowserSubjectGate>
        </ActiveProfileProvider>
      </AndroidModeProvider>
    );
    expect(screen.queryByTestId('records')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('unavailable'));
  });
});
