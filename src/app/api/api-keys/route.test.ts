// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  generateApiKey: vi.fn(),
  createApiKey: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/api-auth', () => ({
  generateApiKey: mocks.generateApiKey,
  AVAILABLE_SCOPES: [{ value: 'read:vitals' }],
}));
vi.mock('@/lib/repos/api-keys', () => ({
  createApiKey: mocks.createApiKey,
  listApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
  AlreadyRevokedError: class extends Error {},
}));

import { POST } from './route';

function request(expiresAt: unknown, includeExpiry = true) {
  return new NextRequest('http://localhost/api/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Temporary reader',
      scopes: ['read:vitals'],
      ...(includeExpiry ? { expires_at: expiresAt } : {}),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ id: 'owner' });
  mocks.generateApiKey.mockReturnValue({ token: 'fixture-token', prefix: 'fixture', hash: 'hash' });
  mocks.createApiKey.mockImplementation(async (_owner, data) => ({
    id: 'fixture-key',
    name: data.name,
    scopes: data.scopes,
    expiresAt: data.expiresAt,
  }));
});

describe('POST /api/api-keys expiry validation', () => {
  it.each(['', ' ', 'not-a-date', 0, false, {}, [], ['2099-01-03']])(
    'rejects malformed explicit expiry %j before generating or writing a key',
    async (expiresAt) => {
      const response = await POST(request(expiresAt));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'expires_at must be a valid date string or null',
      });
      expect(mocks.generateApiKey).not.toHaveBeenCalled();
      expect(mocks.createApiKey).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null])('preserves intentional no-expiry input %j', async (expiresAt) => {
    const response = await POST(request(expiresAt, expiresAt !== undefined));
    expect(response.status).toBe(201);
    expect(mocks.createApiKey).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({ expiresAt: null, scopes: ['read:vitals'] }),
    );
  });

  it.each([
    '2099-01-03T13:00:00.000Z',
    '2099-01-03',
    '2099-01-03T06:00:00-07:00',
    'Sat, 03 Jan 2099 13:00:00 GMT',
    '2000-01-03T13:00:00.000Z',
  ])('preserves a parseable expiry %j without adding a new expiry policy', async (expiresAt) => {
    const response = await POST(request(expiresAt));
    expect(response.status).toBe(201);
    expect(mocks.createApiKey).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({ expiresAt, scopes: ['read:vitals'] }),
    );
    expect(await response.json()).toEqual({
      key: expect.objectContaining({ expires_at: expiresAt }),
      token: 'fixture-token',
    });
  });

  it('still requires a cookie-authenticated owner', async () => {
    mocks.getUser.mockResolvedValue(null);
    expect((await POST(request(null))).status).toBe(401);
    expect(mocks.generateApiKey).not.toHaveBeenCalled();
    expect(mocks.createApiKey).not.toHaveBeenCalled();
  });
});
