import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QueryPage from './page';

const profile = vi.hoisted(() => ({
  dependentId: null as string | null,
  delegateOwnerId: null as string | null,
}));
const auth = vi.hoisted(() => ({ userId: 'owner' as string | null, loading: false }));
const capabilities = vi.hoisted(() => ({ ai: true }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => profile }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: auth.userId ? { id: auth.userId } : null, loading: auth.loading }),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ capabilities }) }));
const fetchMock = vi.fn();
function entry(id: string) {
  return {
    id,
    user_id: 'owner',
    dependent_id: null,
    context_version: 1,
    query_text: 'Synthetic question',
    response_text: `Synthetic answer ${id}`,
    created_at: '2026-10-10T00:00:00Z',
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
  auth.userId = 'owner';
  auth.loading = false;
  capabilities.ai = true;
  fetchMock.mockReset().mockResolvedValue(ok([]));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Health Query page profile boundaries', () => {
  it.each(['dependentId', 'delegateOwnerId'] as const)(
    'hides history, draft input and actions after selecting %s',
    async (field) => {
      fetchMock.mockResolvedValueOnce(ok([entry('owner')]));
      const { rerender } = render(<QueryPage />);
      await screen.findByText('Synthetic question');
      fireEvent.change(screen.getByPlaceholderText('Ask about your health data...'), {
        target: { value: 'Private synthetic owner draft' },
      });
      profile[field] = 'other';
      rerender(<QueryPage />);
      expect(screen.getByText(/available only for My Health/)).toBeInTheDocument();
      expect(screen.queryByText('Synthetic question')).not.toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText('Ask about your health data...')
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledOnce();
      profile[field] = null;
      rerender(<QueryPage />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(screen.getByPlaceholderText('Ask about your health data...')).toHaveValue('');
      expect(screen.queryByText('Synthetic question')).not.toBeInTheDocument();
    }
  );

  it('resets unsent drafts on a direct authenticated-owner change', async () => {
    const { rerender } = render(<QueryPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByPlaceholderText('Ask about your health data...'), {
      target: { value: 'First owner synthetic draft' },
    });
    auth.userId = 'next-owner';
    rerender(<QueryPage />);
    expect(screen.getByPlaceholderText('Ask about your health data...')).toHaveValue('');
  });

  it('does not let a former owner query completion clear a new owner draft', async () => {
    const { rerender } = render(<QueryPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const late = deferred<ReturnType<typeof ok>>();
    fetchMock.mockReturnValueOnce(late.promise);
    fireEvent.change(screen.getByPlaceholderText('Ask about your health data...'), {
      target: { value: 'First owner synthetic question' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    auth.userId = 'next-owner';
    rerender(<QueryPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    fireEvent.change(screen.getByPlaceholderText('Ask about your health data...'), {
      target: { value: 'Next owner synthetic draft' },
    });
    await act(async () => {
      late.resolve(
        ok({ ...entry('old'), context: { ownerId: 'owner', dependentId: null, contextVersion: 1 } })
      );
    });
    expect(screen.getByPlaceholderText('Ask about your health data...')).toHaveValue(
      'Next owner synthetic draft'
    );
    expect(screen.queryByText('Synthetic question')).not.toBeInTheDocument();
  });

  it('renders current query errors without relying on a stale callback closure', async () => {
    render(<QueryPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'Synthetic service failure' }),
    });
    fireEvent.change(screen.getByPlaceholderText('Ask about your health data...'), {
      target: { value: 'Synthetic question' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByText('Synthetic service failure');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('does not load history or show query controls when AI is unavailable', () => {
    capabilities.ai = false;
    render(<QueryPage />);
    expect(screen.getByText(/AI features are not configured/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Ask about your health data...')).not.toBeInTheDocument();
  });
});
