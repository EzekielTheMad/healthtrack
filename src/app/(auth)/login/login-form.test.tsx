import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginForm from './login-form';
const auth = vi.hoisted(() => ({
  social: vi.fn().mockResolvedValue({}),
  email: vi.fn().mockResolvedValue({ error: { message: 'Invalid credentials' } }),
}));
vi.mock('@/lib/auth/client', () => ({ authClient: { signIn: auth, signUp: { email: vi.fn() } } }));
afterEach(() => vi.clearAllMocks());
describe('pairing login continuation', () => {
  it('passes a safe pairing callback to the actual social sign-in action', async () => {
    render(
      <LoginForm
        googleEnabled
        signupPolicy="closed"
        inviteToken={null}
        returnTo="/mobile/pair?request_id=public-request"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Sign in with Google/ }));
    await waitFor(() =>
      expect(auth.social).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: '/mobile/pair?request_id=public-request',
      })
    );
  });
  it('rejects an external social callback', async () => {
    render(
      <LoginForm googleEnabled signupPolicy="closed" inviteToken={null} returnTo="//evil.invalid" />
    );
    fireEvent.click(screen.getByRole('button', { name: /Sign in with Google/ }));
    await waitFor(() =>
      expect(auth.social).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/dashboard' })
    );
  });
});
