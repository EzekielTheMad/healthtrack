import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BottomNav from './BottomNav';
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { ai: true } }),
}));
vi.mock('@/lib/auth/client', () => ({ authClient: { signOut: vi.fn() } }));
describe('daily-use mobile navigation', () => {
  it('keeps fitness and nutrition on the primary bar and groups clinical routes under Health', () => {
    render(<BottomNav activePath="/labs" />);
    for (const label of ['Today', 'Health', 'Fitness', 'Nutrition'])
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Health' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('link', { name: 'Health Query' })).toHaveAttribute('href', '/query');
    expect(screen.getByRole('link', { name: 'Doctor Essentials' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'Health Query' })).toBeNull();
  });
});
