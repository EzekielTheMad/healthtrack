import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrowserSubjectGate, { validateBrowserSubject } from './BrowserSubjectGate';
import { browserHandoffHref } from './BrowserHandoff';
const mocks = vi.hoisted(() => ({
  session: { data: { user: { id: 'owner' } } as { user: { id: string } } | null, isPending: false },
  search: 'browser_subject=self&account_id=owner',
  setActiveProfile: vi.fn(),
  setDelegateProfile: vi.fn(),
}));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => mocks.session,
  authClient: { signOut: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
  usePathname: () => '/labs',
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => mocks }));
beforeEach(() => {
  mocks.session.data = { user: { id: 'owner' } };
  mocks.session.isPending = false;
  mocks.search = 'browser_subject=self&account_id=owner';
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
const signal = new AbortController().signal;
const params = (query: string) => new URLSearchParams(`account_id=owner&${query}`);
describe('browser handoff subject validation', () => {
  it('accepts explicitly selected self without reading a dependent list', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await validateBrowserSubject(params('browser_subject=self'), signal, 'owner')).toEqual({
      kind: 'self',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    '',
    'browser_subject=self&dependent_id=child',
    'browser_subject=dependent&dependent_id=child&owner_id=adult',
    'browser_subject=self&browser_subject=owner',
  ])('rejects absent or mixed scope %s', async (query) => {
    await expect(validateBrowserSubject(params(query), signal, 'owner')).rejects.toThrow();
  });
  it('rejects a missing person rather than selecting the owner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    await expect(
      validateBrowserSubject(
        params('browser_subject=dependent&dependent_id=child'),
        signal,
        'owner'
      )
    ).rejects.toThrow(/unavailable/);
  });
  it('returns only a current owned dependent after authorization succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ id: 'child', name: 'Synthetic child', transitioned: false }],
      })
    );
    expect(
      await validateBrowserSubject(
        params('browser_subject=dependent&dependent_id=child'),
        signal,
        'owner'
      )
    ).toMatchObject({ kind: 'dependent', dependent: { id: 'child' } });
  });
  it('does not accept declined or expired delegated access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { owner_id: 'adult', status: 'accepted', expires_at: '2001-01-01T00:00:00Z' },
        ],
      })
    );
    await expect(
      validateBrowserSubject(params('browser_subject=owner&owner_id=adult'), signal, 'owner')
    ).rejects.toThrow(/unavailable/);
  });
  it('reports authorization failures without consuming their data', async () => {
    const json = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json }));
    await expect(
      validateBrowserSubject(
        params('browser_subject=dependent&dependent_id=child'),
        signal,
        'owner'
      )
    ).rejects.toThrow(/verify/);
    expect(json).not.toHaveBeenCalled();
  });
});

describe('browser handoff account binding', () => {
  it('includes the opening account in self and dependent handoff links', () => {
    expect(
      new URL(
        browserHandoffHref('/labs', null, null, 'owner'),
        'https://health.invalid'
      ).searchParams.get('account_id')
    ).toBe('owner');
    expect(
      new URL(
        browserHandoffHref('/labs', 'child', null, 'owner'),
        'https://health.invalid'
      ).searchParams.get('account_id')
    ).toBe('owner');
  });
  it.each([
    'browser_subject=self',
    'browser_subject=dependent&dependent_id=child',
    'browser_subject=owner&owner_id=adult',
  ])('rejects a different signed-in account before resolving scope %s', async (query) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(validateBrowserSubject(params(query), signal, 'other-account')).rejects.toThrow(
      /same account/
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects an old self handoff that does not name its originating account', async () => {
    await expect(
      validateBrowserSubject(new URLSearchParams('browser_subject=self'), signal, 'owner')
    ).rejects.toThrow(/same account/);
  });
  it('never renders self records for a mismatched account', async () => {
    mocks.session.data = { user: { id: 'other-account' } };
    render(
      <BrowserSubjectGate>
        <p>Protected records</p>
      </BrowserSubjectGate>
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/same account/);
    expect(screen.queryByText('Protected records')).toBeNull();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
  });
  it('shows sign-in recovery when a session expires and preserves account and person', () => {
    mocks.session.data = null;
    mocks.search = 'browser_subject=dependent&dependent_id=child&account_id=owner';
    render(
      <BrowserSubjectGate>
        <p>Protected records</p>
      </BrowserSubjectGate>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired');
    const href = screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')!;
    expect(new URL(href, 'https://health.invalid').searchParams.get('returnTo')).toBe(
      `/labs?${mocks.search}`
    );
    expect(screen.queryByText('Protected records')).toBeNull();
  });
  it('renders a validated self handoff only for the originating account', async () => {
    render(
      <BrowserSubjectGate>
        <p>Protected records</p>
      </BrowserSubjectGate>
    );
    expect(await screen.findByText('Protected records')).toBeInTheDocument();
    expect(mocks.setActiveProfile).toHaveBeenCalledWith(null, null);
  });
});
