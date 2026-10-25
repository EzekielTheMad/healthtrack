import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ view: 'compare', replace: vi.fn(), addVital: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams({ view: navigation.view }),
}));
vi.mock('@/hooks/useVitals', () => ({
  useVitals: () => ({
    vitals: [],
    rawVitals: [],
    sourcePreferences: {},
    sourceConflicts: [],
    chooseSource: vi.fn(),
    sourcePreferenceError: 'Unrelated source preference error',
    canChooseSource: true,
    loading: true,
    error: 'Unrelated global vitals error',
    addVital: navigation.addVital,
  }),
}));
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ profile: null, loading: true }) }));
vi.mock('@/hooks/useActiveGoals', () => ({
  useActiveGoals: () => ({ metricGoals: [], frequencyGoals: [], loading: true }),
}));
vi.mock('@/components/shared/DateRangeContext', () => ({
  useDateRangeContext: () => ({
    dateRange: { start: '2020-01-01', end: '2020-01-02' },
    setDateRange: vi.fn(),
    reportingTimeZone: 'America/Phoenix',
    calendarLoading: true,
  }),
}));
vi.mock('@/components/vitals/ComparisonView', () => ({
  default: ({ refreshRevision }: { refreshRevision: number }) => (
    <p data-testid="comparison-view" data-revision={refreshRevision}>
      Independent comparison view
    </p>
  ),
}));
vi.mock('@/components/vitals/TrendsView', () => ({ default: () => null }));
vi.mock('@/components/vitals/DailyVitalsView', () => ({ default: () => null }));
vi.mock('@/components/vitals/FocusView', () => ({ default: () => null }));
vi.mock('@/components/vitals/MeasurementsPanel', () => ({ default: () => null }));
vi.mock('@/components/vitals/SourcePreferencesPanel', () => ({
  default: () => <p>Unrelated global source panel</p>,
}));
import VitalsPage from './page';

afterEach(cleanup);
beforeEach(() => {
  navigation.addVital.mockReset().mockResolvedValue(undefined);
});

describe('Vitals Compare entry', () => {
  it('renders Compare while unrelated profile, goals, calendar and old-range data are loading', () => {
    render(<VitalsPage />);
    expect(screen.getByText('Independent comparison view')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Compare' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Unrelated global vitals error')).not.toBeInTheDocument();
    expect(screen.queryByText('Unrelated global source panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected Sources:')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Compare' }));
    expect(navigation.replace).toHaveBeenCalledWith('/vitals?view=compare', { scroll: false });
  });

  it('keeps the manual draft open on a failed save and refreshes comparison only after success', async () => {
    navigation.addVital
      .mockRejectedValueOnce(new Error('save rejected'))
      .mockResolvedValueOnce(undefined);
    render(<VitalsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Vital' }));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '82' } });
    const date = screen.getByLabelText('Date & Time') as HTMLInputElement;
    const originalDate = date.value;
    fireEvent.submit(screen.getByRole('form', { name: 'Record a vital reading' }));
    expect(await screen.findByText('Failed to save vital reading.')).toBeInTheDocument();
    expect(screen.getByLabelText('Value')).toHaveValue(82);
    expect(screen.getByLabelText('Date & Time')).toHaveValue(originalDate);
    expect(screen.getByTestId('comparison-view')).toHaveAttribute('data-revision', '0');
    fireEvent.submit(screen.getByRole('form', { name: 'Record a vital reading' }));
    await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
    expect(screen.getByTestId('comparison-view')).toHaveAttribute('data-revision', '1');
  });
});
