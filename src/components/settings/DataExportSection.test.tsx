import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DataExportSection from './DataExportSection';
import { ActiveProfileProvider } from '@/components/shared/ActiveProfileProvider';
const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  user: { id: 'actor', email: 'fictional@example.test' },
  session: { id: 'first' },
}));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => ({ data: { user: auth.user, session: auth.session }, isPending: false }),
  authClient: { signIn: { email: auth.signIn }, signOut: auth.signOut },
}));
const expired = () => ({
  ok: false,
  status: 403,
  json: async () => ({
    error: 'reauth_required',
    message: 'Please re-enter your password before exporting data.',
  }),
});
const download = () => ({ ok: true, blob: async () => new Blob(['{"fictional":true}']) });
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  auth.session = { id: 'first' };
  auth.signIn.mockReset();
  auth.signOut.mockReset();
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const OriginalURL = URL;
  vi.stubGlobal(
    'URL',
    class extends OriginalURL {
      static createObjectURL = vi.fn(() => 'blob:fictional');
      static revokeObjectURL = vi.fn();
    }
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function requestExport() {
  render(<DataExportSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Export as JSON' }));
  return screen.findByRole('form', { name: 'Confirm data export' });
}
describe('data export password confirmation', () => {
  it('offers a real browser-autofill form only when the server requires reauthentication', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(expired()));
    await requestExport();
    expect(screen.getByLabelText('Account email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Account email')).toHaveValue('fictional@example.test');
    expect(screen.getByLabelText('Current password')).toHaveAttribute(
      'autocomplete',
      'current-password'
    );
    expect(screen.getByLabelText('Current password')).toHaveAttribute('type', 'password');
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByText('Clinical correction history')).toBeVisible();
  });
  it('confirms the current account and waits for an explicit export click', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(download());
    vi.stubGlobal('fetch', fetcher);
    auth.signIn.mockResolvedValue({ error: null });
    const form = await requestExport();
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'fictional-test-password' },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole('status')).toHaveTextContent('Password confirmed');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(auth.signIn).toHaveBeenCalledExactlyOnceWith({
      email: 'fictional@example.test',
      password: 'fictional-test-password',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export as JSON' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith('/api/export-data?format=json');
    expect(localStorage.getItem('healthtrack_last_export')).not.toBeNull();
    expect(screen.queryByLabelText('Current password')).toBeNull();
  });
  it('never retries the export after an incorrect password', async () => {
    const fetcher = vi.fn().mockResolvedValue(expired());
    vi.stubGlobal('fetch', fetcher);
    auth.signIn.mockResolvedValue({ error: { message: 'Wrong password' } });
    const form = await requestExport();
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'fictional-wrong-password' },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm your password');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(localStorage.getItem('healthtrack_last_export')).toBeNull();
  });
  it('still refuses a download if the server rejects the refreshed session', async () => {
    const fetcher = vi.fn().mockResolvedValue(expired());
    vi.stubGlobal('fetch', fetcher);
    auth.signIn.mockResolvedValue({ error: null });
    const form = await requestExport();
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'fictional-test-password' },
    });
    fireEvent.submit(form);
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Export as JSON' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('Current password')).toHaveValue('');
    expect(click).not.toHaveBeenCalled();
  });
  it('does not offer password confirmation or download for an unauthenticated request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Authentication required' }),
      })
    );
    render(<DataExportSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Export as JSON' }));
    expect(await screen.findByText('Authentication required')).toBeVisible();
    expect(screen.queryByRole('form')).toBeNull();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
  it('clears the old session before another sign-in method can navigate to login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(expired()));
    let finish!: (value: unknown) => void;
    auth.signOut.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await requestExport();
    const before = window.location.href;
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe(before);
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
    finish({ error: { message: 'Fictional failure' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not clear the current session'
    );
    expect(window.location.href).toBe(before);
    expect(click).not.toHaveBeenCalled();
  });
  it('survives the actual profile-provider session remount without an old export continuation', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Fictional current-view export failure' }),
      });
    vi.stubGlobal('fetch', fetcher);
    const content = () => (
      <ActiveProfileProvider>
        <DataExportSection />
      </ActiveProfileProvider>
    );
    const rendered = render(content());
    fireEvent.click(await screen.findByRole('button', { name: 'Export as JSON' }));
    const form = await screen.findByRole('form', { name: 'Confirm data export' });
    auth.signIn.mockImplementation(async () => {
      auth.session = { id: 'refreshed-session' };
      rendered.rerender(content());
      return { error: null };
    });
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'fictional-test-password' },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.queryByLabelText('Current password')).toBeNull());
    const button = await screen.findByRole('button', { name: 'Export as JSON' });
    expect(screen.getByText(/After confirming your password/)).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(await screen.findByText('Fictional current-view export failure')).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(click).not.toHaveBeenCalled();
  });
});
