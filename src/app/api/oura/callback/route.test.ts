// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  update: vi.fn(),
  personal: vi.fn(),
  save: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'synthetic-state' }), delete: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock('@/lib/auth/session', () => ({ getUser: async () => ({ id: 'synthetic-owner' }) }));
vi.mock('@/lib/capabilities', () => ({ getCapabilities: () => ({ oura: true }) }));
vi.mock('@/lib/crypto/encrypt', () => ({ encrypt: () => 'synthetic-ciphertext' }));
vi.mock('@/lib/oura/oauth-origin', () => ({
  getOuraRedirectUri: () => 'https://example.test/api/oura/callback',
}));
vi.mock('@/lib/repos/profiles', () => ({ getProfile: mocks.profile, upsertProfile: mocks.update }));
vi.mock('@/lib/repos/connected-sources', () => ({ upsertConnectedSource: mocks.save }));
vi.mock('@/lib/oura/sync', () => ({ syncOuraData: mocks.sync }));
vi.mock('@/lib/oura/client', () => ({
  OuraClient: class {
    getPersonalInfo() {
      return mocks.personal();
    }
  },
}));
import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-refresh',
      expires_in: 3600,
    })
  );
  mocks.profile.mockResolvedValue({ dateOfBirth: null, heightInches: null, weightLbs: null });
  mocks.personal.mockResolvedValue({ age: 37, weight: 80, height: 180 });
});
afterEach(() => vi.restoreAllMocks());
describe('Oura profile auto-fill', () => {
  it('never fabricates an exact birth date from provider age', async () => {
    await expect(
      GET(
        new NextRequest(
          'https://example.test/api/oura/callback?code=synthetic-code&state=synthetic-state'
        )
      )
    ).rejects.toThrow('redirect:/settings?oura=connected');
    expect(mocks.update).toHaveBeenCalledWith('synthetic-owner', 'synthetic-owner', {
      heightInches: 71,
      weightLbs: 176,
    });
    expect(mocks.update.mock.calls[0][2]).not.toHaveProperty('dateOfBirth');
  });
});
