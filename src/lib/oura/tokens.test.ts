import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConnectedSource: vi.fn(),
  setConnectedSourceStatus: vi.fn(),
  updateConnectedSourceTokens: vi.fn(),
}));

vi.mock('@/lib/crypto/decrypt', () => ({
  decrypt: (value: string) => value.replace(/^encrypted:/, ''),
}));
vi.mock('@/lib/crypto/encrypt', () => ({
  encrypt: (value: string) => `encrypted:${value}`,
}));
vi.mock('@/lib/repos/connected-sources', () => mocks);

import { getOuraAccessToken } from './tokens';

const source = {
  id: 'source-1',
  userId: 'user-1',
  sourceName: 'oura',
  status: 'active',
  accessTokenEncrypted: 'encrypted:old-access',
  refreshTokenEncrypted: 'encrypted:old-refresh',
  tokenExpiresAt: '2020-01-01T00:00:00.000Z',
  lastSyncAt: null,
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
};

beforeEach(() => {
  process.env.OURA_CLIENT_ID = 'client-id';
  process.env.OURA_CLIENT_SECRET = 'client-secret';
  mocks.getConnectedSource.mockReset().mockResolvedValue(source);
  mocks.setConnectedSourceStatus.mockReset().mockResolvedValue(undefined);
  mocks.updateConnectedSourceTokens.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

afterEach(() => {
  delete process.env.OURA_CLIENT_ID;
  delete process.env.OURA_CLIENT_SECRET;
});

describe('Oura token refresh', () => {
  it('coalesces concurrent refreshes and persists one rotated token response', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));

    const first = getOuraAccessToken('user-1');
    const second = getOuraAccessToken('user-1');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveFetch(
      Response.json({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      })
    );

    await expect(Promise.all([first, second])).resolves.toEqual(['new-access', 'new-access']);
    expect(mocks.updateConnectedSourceTokens).toHaveBeenCalledTimes(1);
    expect(mocks.updateConnectedSourceTokens).toHaveBeenCalledWith(
      'user-1',
      'source-1',
      expect.objectContaining({
        accessTokenEncrypted: 'encrypted:new-access',
        refreshTokenEncrypted: 'encrypted:new-refresh',
      })
    );
    expect(mocks.setConnectedSourceStatus).not.toHaveBeenCalled();
  });

  it('keeps the connection active for transient provider failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: 'temporarily_unavailable', error_description: 'try later' },
        { status: 503 }
      )
    );

    await expect(getOuraAccessToken('user-1')).rejects.toThrow(
      /temporarily_unavailable: try later/
    );
    expect(mocks.setConnectedSourceStatus).not.toHaveBeenCalled();
    expect(mocks.updateConnectedSourceTokens).not.toHaveBeenCalled();
  });

  it('expires the connection only for terminal invalid_grant responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: 'invalid_grant', error_description: 'refresh token revoked' },
        { status: 400 }
      )
    );

    await expect(getOuraAccessToken('user-1')).rejects.toThrow(/invalid_grant/);
    expect(mocks.setConnectedSourceStatus).toHaveBeenCalledWith('user-1', 'oura', 'expired');
  });

  it('does not expire an active connection for local OAuth configuration errors', async () => {
    delete process.env.OURA_CLIENT_SECRET;
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(getOuraAccessToken('user-1')).rejects.toThrow(
      /client credentials are not configured/
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.setConnectedSourceStatus).not.toHaveBeenCalled();
  });
});
