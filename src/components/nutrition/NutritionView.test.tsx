/**
 * Nutrition page states.
 *
 * The state that matters most: an authorization/network/server failure must
 * NEVER render the empty state. "No nutrition data yet" tells the user their
 * food log is empty; a 403 means we could not look. Conflating them is how a
 * broken token reads as a lost day of eating.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import NutritionView, { formatNutrient, type NutritionDay } from './NutritionView';
import { nutritionSourceLabel } from '@/lib/nutrition/sources';

function day(overrides: Partial<NutritionDay> = {}): NutritionDay {
  return {
    date: '2026-08-31',
    source_package: 'com.sbs.diet',
    calories: 2147.099,
    protein_grams: 190.913,
    carbs_grams: 199.891,
    fat_grams: 70.927,
    record_count: 10,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** A fetch that never settles, so the loading state stays observable. */
function pendingFetch() {
  return vi.fn(() => new Promise<Response>(() => {}));
}

function jsonFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(
    async (...args: unknown[]): Promise<Response> => {
      void args;
      return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: async () => body,
      } as unknown as Response;
    },
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-09-01T18:00:00Z'), shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('formatNutrient', () => {
  it('renders unknown as a dash and a reported zero as zero', () => {
    expect(formatNutrient(null)).toBe('—');
    expect(formatNutrient(undefined)).toBe('—');
    expect(formatNutrient(0)).toBe('0');
    expect(formatNutrient(0, 1)).toBe('0.0');
  });

  it('rounds for display without claiming precision it does not have', () => {
    expect(formatNutrient(2147.099)).toBe('2147');
    expect(formatNutrient(190.913, 1)).toBe('190.9');
  });
});

describe('loading state', () => {
  it('shows skeletons, and neither the empty state nor an error', () => {
    vi.stubGlobal('fetch', pendingFetch());
    const { container } = render(<NutritionView />);

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText(/no nutrition data yet/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('error state', () => {
  it('never renders "No nutrition data yet" for a 403', async () => {
    vi.stubGlobal(
      'fetch',
      jsonFetch({ error: 'Insufficient permissions. Required scope: read:nutrition' }, {
        ok: false,
        status: 403,
      }),
    );
    render(<NutritionView />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load your nutrition/i);
    expect(alert).toHaveTextContent(/read:nutrition/);
    expect(screen.queryByText(/no nutrition data yet/i)).toBeNull();
  });

  it('reports a server failure and offers a retry that refetches', async () => {
    const failing = jsonFetch({ error: 'internal_error' }, { ok: false, status: 500 });
    vi.stubGlobal('fetch', failing);
    render(<NutritionView />);

    await screen.findByRole('alert');
    expect(failing).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(2));
  });

  it('reports a network failure rather than an empty log', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Failed to fetch');
      }),
    );
    render(<NutritionView />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/failed to fetch/i);
    expect(screen.queryByText(/no nutrition data yet/i)).toBeNull();
  });
});

describe('empty state', () => {
  it('renders only for a SUCCESSFUL response with no rows', async () => {
    vi.stubGlobal('fetch', jsonFetch([]));
    render(<NutritionView />);

    expect(await screen.findByText(/no nutrition data yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    // Points at the fix for retained-but-unnormalized records.
    expect(screen.getByText(/reprocess retained nutrition/i)).toBeInTheDocument();
  });
});

describe('populated state', () => {
  it('shows a Today card, the friendly source label, and the history table', async () => {
    vi.stubGlobal(
      'fetch',
      jsonFetch([
        day(),
        day({
          date: '2026-09-01',
          calories: 1030.868,
          protein_grams: 129.315,
          carbs_grams: 79.015,
          fat_grams: 23.586,
          record_count: 6,
        }),
      ]),
    );
    render(<NutritionView />);

    // Today is 2026-09-01 (fake timers), and it has a row.
    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getAllByText('1031').length).toBeGreaterThan(0);
    // The user sees "MacroFactor", the store keeps "com.sbs.diet".
    expect(nutritionSourceLabel('com.sbs.diet')).toBe('MacroFactor');
    expect(screen.getAllByText('MacroFactor').length).toBeGreaterThan(0);
    expect(screen.queryByText('com.sbs.diet')).toBeNull();
    // Both days are listed with their record counts.
    expect(screen.getByText('2026-08-31')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01')).toBeInTheDocument();
  });

  it('falls back to the most recent day when today has no import yet', async () => {
    vi.stubGlobal('fetch', jsonFetch([day({ date: '2026-08-30' })]));
    render(<NutritionView />);

    expect(await screen.findByText('Most recent day')).toBeInTheDocument();
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('renders an unreported nutrient as a dash, not zero', async () => {
    vi.stubGlobal(
      'fetch',
      jsonFetch([
        day({ date: '2026-09-01', protein_grams: null, carbs_grams: null, fat_grams: 0 }),
      ]),
    );
    render(<NutritionView />);

    await screen.findByText('Today');
    // Protein and carbs unknown → dashes; fat reported as 0 → "0.0".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('0.0').length).toBeGreaterThan(0);
  });

  it('shows an unmapped package verbatim rather than inventing a name', async () => {
    vi.stubGlobal('fetch', jsonFetch([day({ source_package: 'com.unknown.tracker' })]));
    render(<NutritionView />);

    expect(await screen.findAllByText('com.unknown.tracker')).not.toHaveLength(0);
  });

  it('refetches when the range changes', async () => {
    const fetcher = jsonFetch([day()]);
    vi.stubGlobal('fetch', fetcher);
    render(<NutritionView />);

    await screen.findByText(/most recent day|today/i);
    fireEvent.click(screen.getByRole('tab', { name: '90 days' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(String(fetcher.mock.calls[1][0])).toContain('start_date=2026-06-03');
  });
});
