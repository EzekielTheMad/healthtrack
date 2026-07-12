/**
 * HealthSummaryCard — cache-aware rendering + per-day collapse.
 *
 * Covers: instant render of a cached summary (no full-card spinner), the
 * "updating…" affordance when the server serves a stale row, and the
 * collapse/expand toggle with per-day localStorage persistence + restore.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import HealthSummaryCard from './HealthSummaryCard';

// AI is configured — the card renders.
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { ai: true }, loading: false }),
}));

const COLLAPSE_KEY = 'ht:health-overview-collapsed';

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface SummaryPayload {
  summary: string;
  highlights: Array<{ type: string; text: string }>;
  cached?: boolean;
  stale?: boolean;
  generated_at?: string | null;
}

function stubFetch(payload: SummaryPayload) {
  const fn = vi.fn(async () => ({
    ok: true,
    json: async () => payload,
  }));
  vi.stubGlobal('fetch', fn as unknown as typeof fetch);
  return fn;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CACHED: SummaryPayload = {
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

    await waitFor(() =>
      expect(screen.getByText(/doing well overall/i)).toBeInTheDocument(),
    );
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
    await waitFor(() =>
      expect(screen.getByText('Blood pressure is stable.')).toBeInTheDocument(),
    );

    // The toggle's accessible name comes from its "Health Overview" heading.
    const toggle = screen.getByRole('button', { name: /health overview/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);

    // Body (highlights) hidden; teaser (first clause) shown.
    expect(screen.queryByText('Blood pressure is stable.')).not.toBeInTheDocument();
    expect(screen.getByText('You are doing well overall.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /health overview/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Persisted keyed by today.
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe(todayLocal());
  });

  it('restores the collapsed state from localStorage on mount (today\'s key)', async () => {
    localStorage.setItem(COLLAPSE_KEY, todayLocal());
    stubFetch(CACHED);
    render(<HealthSummaryCard />);

    await waitFor(() =>
      expect(screen.getByText('You are doing well overall.')).toBeInTheDocument(),
    );
    // Starts collapsed: full highlight body is not shown.
    expect(screen.queryByText('Blood pressure is stable.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /health overview/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('ignores a collapse key stored on a previous day', async () => {
    localStorage.setItem(COLLAPSE_KEY, '2000-01-01');
    stubFetch(CACHED);
    render(<HealthSummaryCard />);

    await waitFor(() =>
      expect(screen.getByText('Blood pressure is stable.')).toBeInTheDocument(),
    );
    // Stale key ignored → expanded by default.
    expect(screen.getByRole('button', { name: /health overview/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
