import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { DateRangeProvider, useDateRangeContext } from './DateRangeContext';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.api }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});
function Calendar() {
  const { reportingTimeZone, calendarLoading } = useDateRangeContext();
  return <div>{calendarLoading ? 'Resolving calendar' : `Resolved ${reportingTimeZone}`}</div>;
}
describe('instance reporting calendar', () => {
  it('waits for validated instance timezone metadata', async () => {
    let resolve!: (value: { timezone: string }) => void;
    mocks.api.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(
      <DateRangeProvider>
        <Calendar />
      </DateRangeProvider>
    );
    expect(screen.getByText('Resolving calendar')).toBeInTheDocument();
    await act(async () => {
      resolve({ timezone: 'America/Phoenix' });
    });
    expect(screen.getByText('Resolved America/Phoenix')).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith(
      '/api/build',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
  it.each(['network', 'invalid'])(
    'shows an explicit UTC fallback after %s metadata failure',
    async (failure) => {
      if (failure === 'network') mocks.api.mockRejectedValue(new Error('Unavailable'));
      else mocks.api.mockResolvedValue({ timezone: 'invalid/timezone' });
      render(
        <DateRangeProvider>
          <Calendar />
        </DateRangeProvider>
      );
      await waitFor(() => expect(screen.getByText('Resolved Etc/UTC')).toBeInTheDocument());
      expect(screen.getByRole('status')).toHaveTextContent(
        'Reporting timezone unavailable. Showing calendar days in UTC'
      );
    }
  );
  it('bounds a hung metadata request and exits loading with a visible fallback', async () => {
    vi.useFakeTimers();
    mocks.api.mockImplementation(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
        })
    );
    render(
      <DateRangeProvider>
        <Calendar />
      </DateRangeProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(screen.getByText('Resolved Etc/UTC')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('reload to retry');
  });
});
