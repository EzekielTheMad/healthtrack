import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { IntegrationHealthProvider } from './IntegrationHealthProvider';
import { useIntegrationHealth } from '@/hooks/useIntegrationHealth';

const mocks = vi.hoisted(() => ({
  account: 'owner-a' as string | null,
  pending: false,
  api: vi.fn(),
}));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => ({
    data: mocks.account ? { user: { id: mocks.account } } : null,
    isPending: mocks.pending,
  }),
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.api }));

function Consumer({ name }: { name: string }) {
  const state = useIntegrationHealth();
  return (
    <div data-testid={name}>
      {JSON.stringify({
        sources: state.integrations.map((item) => item.source),
        error: state.error,
        loading: state.loading,
      })}
    </div>
  );
}
function Fixture() {
  return (
    <IntegrationHealthProvider>
      <Consumer name="one" />
      <Consumer name="two" />
    </IntegrationHealthProvider>
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = 'owner-a';
  mocks.pending = false;
});

describe('account-scoped integration snapshot', () => {
  it('keeps consumers loading until the initial session is known', async () => {
    mocks.account = null;
    mocks.pending = true;
    mocks.api.mockResolvedValue([{ source: 'oura' }]);
    const view = render(<Fixture />);
    expect(screen.getByTestId('one')).toHaveTextContent('"loading":true');
    expect(mocks.api).not.toHaveBeenCalled();
    mocks.account = 'owner-a';
    mocks.pending = false;
    view.rerender(<Fixture />);
    await waitFor(() => expect(screen.getByTestId('one')).toHaveTextContent('oura'));
  });
  it('shares one request between consumers and clears an error after recovery', async () => {
    mocks.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([{ source: 'oura' }]);
    render(<Fixture />);
    await waitFor(() => expect(screen.getByTestId('one')).toHaveTextContent('Could not load'));
    expect(mocks.api).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(screen.getByTestId('two')).toHaveTextContent('oura'));
    expect(screen.getByTestId('one')).toHaveTextContent('"error":null');
  });

  it('ignores an older response after a mutation invalidates the snapshot', async () => {
    let resolve!: (value: unknown) => void;
    mocks.api
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        })
      )
      .mockResolvedValueOnce([{ source: 'updated' }]);
    render(<Fixture />);
    act(() => window.dispatchEvent(new Event('integration-health-changed')));
    await waitFor(() => expect(screen.getByTestId('one')).toHaveTextContent('updated'));
    await act(async () => resolve([{ source: 'outdated' }]));
    expect(screen.getByTestId('one')).not.toHaveTextContent('outdated');
  });

  it('clears visible data immediately on account change and ignores previous-account requests', async () => {
    mocks.api.mockResolvedValueOnce([{ source: 'owner-a-source' }]);
    const view = render(<Fixture />);
    await waitFor(() => expect(screen.getByTestId('one')).toHaveTextContent('owner-a-source'));
    let resolve!: (value: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    act(() => window.dispatchEvent(new Event('focus')));
    mocks.api.mockResolvedValueOnce([{ source: 'owner-b-source' }]);
    mocks.account = 'owner-b';
    view.rerender(<Fixture />);
    expect(screen.getByTestId('one')).not.toHaveTextContent('owner-a-source');
    await waitFor(() => expect(screen.getByTestId('one')).toHaveTextContent('owner-b-source'));
    await act(async () => resolve([{ source: 'late-owner-a-source' }]));
    expect(screen.getByTestId('one')).not.toHaveTextContent('late-owner-a-source');
    mocks.account = null;
    view.rerender(<Fixture />);
    expect(screen.getByTestId('one')).toHaveTextContent('"sources":[]');
  });

  it('deduplicates focus refreshes while a request is pending', async () => {
    mocks.api.mockReturnValue(new Promise(() => {}));
    render(<Fixture />);
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });
});
