/**
 * HealthSummaryCard — cache-aware rendering + per-day collapse.
 *
 * Covers: instant render of a cached summary (no full-card spinner), the
 * "updating…" affordance when the server serves a stale row, and the
 * collapse/expand toggle with per-day localStorage persistence + restore.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import HealthSummaryCard from './HealthSummaryCard';

// AI is configured — the card renders.
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { ai: true }, loading: false }),
}));

const profile = vi.hoisted(() => ({
  dependentId: null as string | null,
  delegateOwnerId: null as string | null,
}));
const auth = vi.hoisted(() => ({ userId: 'owner' as string | null, loading: false }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => profile }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: auth.userId ? { id: auth.userId } : null, loading: auth.loading }),
}));
const CONTEXT = { ownerId: 'owner', dependentId: null, contextVersion: 1 };

const COLLAPSE_KEY = 'ht:health-overview-collapsed';

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface SummaryPayload {
  context?: unknown;
  summary: string;
  highlights: Array<{ type: string; text: string; labTests?: string[] }>;
  cached?: boolean;
  stale?: boolean;
  generated_at?: string | null;
}

function stubFetch(payload: SummaryPayload) {
  const fn = vi.fn<typeof fetch>().mockResolvedValue({
    ok: true,
    json: async () => payload,
  } as Response);
  vi.stubGlobal('fetch', fn as unknown as typeof fetch);
  return fn;
}

beforeEach(() => {
  localStorage.clear();
  profile.dependentId = null;
  profile.delegateOwnerId = null;
  auth.userId = 'owner';
  auth.loading = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CACHED: SummaryPayload = {
  context: CONTEXT,
  summary: 'You are doing well overall. Keep up the routine.',
  highlights: [{ type: 'positive', text: 'Blood pressure is stable.' }],
  cached: true,
  stale: false,
  generated_at: '2026-07-10T13:00:00Z',
};

describe('HealthSummaryCard — rendering', () => {
  it('renders the cached summary and highlights (no persistent spinner)', async () => {
    stubFetch(CACHED);
    render(<HealthSummaryCard />);

    await waitFor(() => expect(screen.getByText(/doing well overall/i)).toBeInTheDocument());
    expect(screen.getByText('Blood pressure is stable.')).toBeInTheDocument();
    expect(screen.queryByText(/Generating your health overview/i)).not.toBeInTheDocument();
    expect(screen.queryByText('updating…')).not.toBeInTheDocument();
  });

  it('shows an "updating…" affordance when the server serves a stale row', async () => {
    stubFetch({ ...CACHED, stale: true });
    render(<HealthSummaryCard />);

    await waitFor(() => expect(screen.getByText('updating…')).toBeInTheDocument());
    // Still shows the last good summary, not a blocking spinner.
    expect(screen.getByText(/doing well overall/i)).toBeInTheDocument();
    expect(screen.queryByText(/Generating your health overview/i)).not.toBeInTheDocument();
  });
});

describe('HealthSummaryCard — collapse', () => {
  it('toggles collapsed: hides the body, shows a teaser, and persists for the day', async () => {
    stubFetch(CACHED);
    render(<HealthSummaryCard />);
    await waitFor(() => expect(screen.getByText('Blood pressure is stable.')).toBeInTheDocument());

    // The toggle's accessible name comes from its "Health Overview" heading.
    const toggle = screen.getByRole('button', { name: /health overview/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);

    // Body (highlights) hidden; teaser (first clause) shown.
    expect(screen.queryByText('Blood pressure is stable.')).not.toBeInTheDocument();
    expect(screen.getByText('You are doing well overall.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /health overview/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    // Persisted keyed by today.
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe(todayLocal());
  });

  it("restores the collapsed state from localStorage on mount (today's key)", async () => {
    localStorage.setItem(COLLAPSE_KEY, todayLocal());
    stubFetch(CACHED);
    render(<HealthSummaryCard />);

    await waitFor(() =>
      expect(screen.getByText('You are doing well overall.')).toBeInTheDocument()
    );
    // Starts collapsed: full highlight body is not shown.
    expect(screen.queryByText('Blood pressure is stable.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /health overview/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('ignores a collapse key stored on a previous day', async () => {
    localStorage.setItem(COLLAPSE_KEY, '2000-01-01');
    stubFetch(CACHED);
    render(<HealthSummaryCard />);

    await waitFor(() => expect(screen.getByText('Blood pressure is stable.')).toBeInTheDocument());
    // Stale key ignored → expanded by default.
    expect(screen.getByRole('button', { name: /health overview/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function ok(payload: unknown) {
  return { ok: true, json: vi.fn(async () => payload) };
}

describe('HealthSummaryCard — owner context isolation', () => {
  it.each(['dependentId', 'delegateOwnerId'] as const)(
    'explains owner-only behavior and never fetches for %s',
    async (field) => {
      profile[field] = 'other';
      const fetch = stubFetch(CACHED);
      render(<HealthSummaryCard />);
      expect(screen.getByText(/available only for My Health/)).toBeInTheDocument();
      expect(screen.queryByText(CACHED.summary)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('waits for a verified owner session and explicitly requests self', async () => {
    auth.loading = true;
    const fetch = stubFetch(CACHED);
    const { rerender } = render(<HealthSummaryCard />);
    expect(fetch).not.toHaveBeenCalled();
    auth.loading = false;
    rerender(<HealthSummaryCard />);
    await screen.findByText(CACHED.summary);
    expect(fetch.mock.calls[0][0]).toBe('/api/health-summary?dependent_id=self');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][0]).toBe('/api/health-summary?dependent_id=self&refresh=1');
  });

  it.each([
    undefined,
    { ...CONTEXT, ownerId: 'other-owner' },
    { ...CONTEXT, dependentId: 'child' },
    { ...CONTEXT, contextVersion: 0 },
  ])('rejects missing or mismatched summary metadata: %j', async (context) => {
    stubFetch({ ...CACHED, context });
    render(<HealthSummaryCard />);
    await screen.findByText('AI summary is temporarily unavailable.');
    expect(screen.queryByText(CACHED.summary)).not.toBeInTheDocument();
  });

  it('immediately hides data and does not parse a late response after self → other → self', async () => {
    const late = deferred<ReturnType<typeof ok>>();
    const fetch = vi.fn().mockResolvedValueOnce(ok(CACHED)).mockReturnValueOnce(late.promise);
    vi.stubGlobal('fetch', fetch);
    const { rerender } = render(<HealthSummaryCard />);
    await screen.findByText(CACHED.summary);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    profile.dependentId = 'child';
    rerender(<HealthSummaryCard />);
    expect(screen.queryByText(CACHED.summary)).not.toBeInTheDocument();
    const current = { ...CACHED, summary: 'Fresh owner visit.' };
    fetch.mockResolvedValueOnce(ok(current));
    profile.dependentId = null;
    rerender(<HealthSummaryCard />);
    await screen.findByText(current.summary);
    const oldResponse = ok({ ...CACHED, summary: 'Old owner request.' });
    await act(async () => {
      late.resolve(oldResponse);
    });
    expect(oldResponse.json).not.toHaveBeenCalled();
    expect(screen.queryByText('Old owner request.')).not.toBeInTheDocument();
    expect(screen.getByText(current.summary)).toBeInTheDocument();
  });

  it('ignores JSON that resolves after changing authenticated owners', async () => {
    const late = deferred<unknown>();
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: () => late.promise });
    vi.stubGlobal('fetch', fetch);
    const { rerender } = render(<HealthSummaryCard />);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    auth.userId = 'next-owner';
    fetch.mockResolvedValueOnce(
      ok({
        ...CACHED,
        summary: 'Next owner overview.',
        context: { ...CONTEXT, ownerId: 'next-owner' },
      })
    );
    rerender(<HealthSummaryCard />);
    await screen.findByText('Next owner overview.');
    await act(async () => {
      late.resolve(CACHED);
    });
    expect(screen.queryByText(CACHED.summary)).not.toBeInTheDocument();
  });

  it('does not use late dismissal indices against refreshed highlights', async () => {
    const oldHighlight = { type: 'attention', text: 'Old synthetic warning', labTests: ['test-a'] };
    const late = deferred<ReturnType<typeof ok>>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ ...CACHED, highlights: [oldHighlight] }))
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(
        ok({
          ...CACHED,
          highlights: [{ type: 'attention', text: 'New synthetic warning', labTests: ['test-b'] }],
        })
      );
    vi.stubGlobal('fetch', fetch);
    render(<HealthSummaryCard />);
    await screen.findByText(oldHighlight.text);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss until new lab results' }));
    expect(fetch.mock.calls[1][0]).toBe('/api/lab-warning-dismissals?dependent_id=self');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('New synthetic warning');
    await act(async () => {
      late.resolve(ok({ context: CONTEXT }));
    });
    expect(screen.getByText('New synthetic warning')).toBeInTheDocument();
  });

  it.each([undefined, { ...CONTEXT, ownerId: 'other' }, { ...CONTEXT, contextVersion: 0 }])(
    'keeps warnings when dismissal response context is invalid: %j',
    async (context) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          ok({
            ...CACHED,
            highlights: [{ type: 'attention', text: 'Synthetic warning', labTests: ['test-a'] }],
          })
        )
        .mockResolvedValueOnce(ok({ context }));
      vi.stubGlobal('fetch', fetch);
      render(<HealthSummaryCard />);
      await screen.findByText('Synthetic warning');
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss until new lab results' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Dismiss until new lab results' })).toBeEnabled()
      );
      expect(screen.getByText('Synthetic warning')).toBeInTheDocument();
    }
  );

  it('does not consume a summary response after unmount', async () => {
    const late = deferred<ReturnType<typeof ok>>();
    const fetch = vi.fn().mockReturnValueOnce(late.promise);
    vi.stubGlobal('fetch', fetch);
    const { unmount } = render(<HealthSummaryCard />);
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    const response = ok(CACHED);
    await act(async () => {
      late.resolve(response);
    });
    expect(response.json).not.toHaveBeenCalled();
  });

  it('does not apply a dismissal to a later owner visit', async () => {
    const late = deferred<ReturnType<typeof ok>>();
    const payload = {
      ...CACHED,
      highlights: [{ type: 'attention', text: 'Synthetic warning', labTests: ['test-a'] }],
    };
    const fetch = vi.fn().mockResolvedValueOnce(ok(payload)).mockReturnValueOnce(late.promise);
    vi.stubGlobal('fetch', fetch);
    const { rerender } = render(<HealthSummaryCard />);
    await screen.findByText('Synthetic warning');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss until new lab results' }));
    profile.delegateOwnerId = 'delegate';
    rerender(<HealthSummaryCard />);
    expect(screen.queryByText('Synthetic warning')).not.toBeInTheDocument();
    profile.delegateOwnerId = null;
    fetch.mockResolvedValueOnce(ok(payload));
    rerender(<HealthSummaryCard />);
    await screen.findByText('Synthetic warning');
    await act(async () => {
      late.resolve(ok({ context: CONTEXT }));
    });
    expect(screen.getByText('Synthetic warning')).toBeInTheDocument();
  });
});
