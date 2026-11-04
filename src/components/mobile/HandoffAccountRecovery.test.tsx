import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HandoffAccountRecovery from './HandoffAccountRecovery';
const signOut = vi.hoisted(() => vi.fn().mockResolvedValue({ error: { message: 'Synthetic failure' } }));
vi.mock('@/lib/auth/client', () => ({ authClient: { signOut } }));
describe('expired handoff recovery', () => {
  it('clears a stale cookie before navigating and reports a failed sign-out without losing continuation', async () => {
    const target = '/labs?browser_subject=dependent&dependent_id=child&account_id=owner';
    render(<HandoffAccountRecovery returnTo={target} signedIn={false} />);
    const link = screen.getByRole('link', { name: 'Sign in again' });
    expect(new URL(link.getAttribute('href')!, 'https://health.invalid').searchParams.get('returnTo')).toBe(target);
    fireEvent.click(link);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not clear the current session');
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', link.getAttribute('href'));
  });
});
