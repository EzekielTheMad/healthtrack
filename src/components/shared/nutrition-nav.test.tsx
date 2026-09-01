/**
 * Nutrition's product placement: a top-level destination, not a Fitness tab.
 *
 * Pins the decision so a later refactor cannot quietly fold food intake back
 * under training — they have different sources of truth and different cadences,
 * and /fitness was where Nutrition went unfound.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SidebarNav from './SidebarNav';
import BottomNav from './BottomNav';
import FitnessPage from '@/app/(app)/fitness/page';

vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { ai: true }, loading: false }),
}));

vi.mock('@/lib/auth/client', () => ({
  authClient: { signOut: vi.fn() },
}));

// The Fitness tabs mount data-fetching views; the placement assertions only
// need the tab strip itself.
vi.mock('@/components/fitness/HistoryView', () => ({ default: () => <div>history</div> }));
vi.mock('@/components/fitness/TrendsView', () => ({ default: () => <div>trends</div> }));
vi.mock('@/components/fitness/WeeklyView', () => ({ default: () => <div>weekly</div> }));
vi.mock('@/components/fitness/GoalsView', () => ({ default: () => <div>goals</div> }));

describe('primary navigation', () => {
  it('offers Nutrition as a top-level sidebar destination at /nutrition', () => {
    render(<SidebarNav activePath="/dashboard" />);
    const link = screen.getByRole('link', { name: /nutrition/i });
    expect(link).toHaveAttribute('href', '/nutrition');
  });

  it('marks the sidebar entry active on the nutrition page', () => {
    render(<SidebarNav activePath="/nutrition" />);
    const link = screen.getByRole('link', { name: /nutrition/i });
    expect(link).toHaveStyle({ color: 'var(--color-sage)' });
  });

  it('reaches Nutrition from the mobile More sheet', () => {
    render(<BottomNav activePath="/dashboard" />);
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    const link = screen.getByRole('link', { name: /nutrition/i });
    expect(link).toHaveAttribute('href', '/nutrition');
  });
});

describe('fitness page', () => {
  it('no longer carries a Nutrition tab', () => {
    render(<FitnessPage />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['History', 'Trends', 'Weekly', 'Goals & catalog']);
    expect(screen.queryByRole('tab', { name: /nutrition/i })).toBeNull();
  });

  it('keeps workouts, weekly training, history and the exercise catalog', () => {
    render(<FitnessPage />);
    for (const label of ['History', 'Trends', 'Weekly', 'Goals & catalog']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
  });
});
