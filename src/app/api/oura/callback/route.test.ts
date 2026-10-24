// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  update: vi.fn(),
  personal: vi.fn(),
  save: vi.fn(),
  sync: vi.fn(),
  cookieResponse: null as NextResponse | null,
  log: vi.fn(),
  configured: true,
  userId: 'synthetic-owner' as string | null,
  expectedState: 'synthetic-state' as string | null,
}));
vi.mock('next/headers', () => ({
  cookies: async () => {
    const response = mocks.cookieResponse!;
    if (mocks.expectedState !== null)
      response.cookies.set('oura_oauth_state', mocks.expectedState, { path: '/api/oura' });
    return response.cookies;
  },
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock('@/lib/auth/session', () => ({
  getUser: async () => (mocks.userId ? { id: mocks.userId } : null),
}));
vi.mock('@/lib/capabilities', () => ({ getCapabilities: () => ({ oura: mocks.configured }) }));
vi.mock('@/lib/crypto/encrypt', () => ({ encrypt: () => 'synthetic-ciphertext' }));
vi.mock('@/lib/safe-log', () => ({ safeError: mocks.log }));
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

const request = (params = 'code=synthetic-code&state=synthetic-state') =>
  new NextRequest(`https://example.test/api/oura/callback?${params}`);
const redirectTo = (suffix: string) => `redirect:/settings?tab=integrations&${suffix}#oura`;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured = true;
  mocks.userId = 'synthetic-owner';
  mocks.expectedState = JSON.stringify({ state: 'synthetic-state', userId: 'synthetic-owner' });
  mocks.cookieResponse = new NextResponse();
  vi.stubEnv('OURA_CLIENT_ID', 'synthetic-client');
  vi.stubEnv('OURA_CLIENT_SECRET', 'synthetic-client-secret');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-refresh',
      expires_in: 3600,
    })
  );
  mocks.save.mockResolvedValue({});
  mocks.sync.mockResolvedValue({ synced: 10, errors: [], outcome: 'success' });
  mocks.profile.mockResolvedValue({ dateOfBirth: null, heightInches: null, weightLbs: null });
  mocks.personal.mockResolvedValue({ age: 37, weight: 80, height: 180 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Oura callback completion', () => {
  it('preserves encrypted storage, callback URI, awaited backfill, and truthful successful outcome', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=connected&initial_sync=success'));
    expect(timeout).toHaveBeenCalledWith(20_000);
    const options = vi.mocked(fetch).mock.calls[0][1]!;
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(new URLSearchParams(options.body as string).get('redirect_uri')).toBe(
      'https://example.test/api/oura/callback'
    );
    expect(mocks.cookieResponse!.cookies.get('oura_oauth_state')).toMatchObject({
      value: '',
      path: '/api/oura',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
    });
    const expiredCookie = mocks.cookieResponse!.headers.get('set-cookie');
    expect(expiredCookie).toContain('Path=/api/oura');
    expect(expiredCookie).toContain('Max-Age=0');
    expect(expiredCookie).toContain('HttpOnly');
    expect(expiredCookie).toContain('SameSite=lax');
    expect(mocks.save).toHaveBeenCalledWith(
      'synthetic-owner',
      'oura',
      expect.objectContaining({
        accessTokenEncrypted: 'synthetic-ciphertext',
        refreshTokenEncrypted: 'synthetic-ciphertext',
      })
    );
    expect(mocks.sync).toHaveBeenCalledWith('synthetic-owner', 'synthetic-access', true);
  });
  it.each([
    ['empty', { synced: 0, errors: [], outcome: 'success' }],
    ['partial', { synced: 3, errors: ['safe fixed error'], outcome: 'partial' }],
    ['failed', { synced: 0, errors: ['safe fixed error'], outcome: 'failed' }],
  ])('reports %s initial sync independently of saved authorization', async (result, summary) => {
    mocks.sync.mockResolvedValue(summary);
    await expect(GET(request())).rejects.toThrow(
      redirectTo(`oura=connected&initial_sync=${result}`)
    );
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('reports a thrown backfill as failed without discarding saved authorization', async () => {
    mocks.sync.mockRejectedValue(new Error('synthetic backfill failure'));
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=connected&initial_sync=failed'));
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('waits for the initial sync before announcing completion', async () => {
    let finish!: (summary: unknown) => void;
    mocks.sync.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    let finished = false;
    const result = GET(request()).catch((error: Error) => {
      finished = true;
      return error.message;
    });
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    finish({ synced: 0, errors: [], outcome: 'success' });
    expect(await result).toBe(redirectTo('oura=connected&initial_sync=empty'));
  });
  it('never fabricates an exact birth date from provider age', async () => {
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=connected&initial_sync=success'));
    expect(mocks.update).toHaveBeenCalledWith('synthetic-owner', 'synthetic-owner', {
      heightInches: 71,
      weightLbs: 176,
    });
    expect(mocks.update.mock.calls[0][2]).not.toHaveProperty('dateOfBirth');
  });
});

describe('safe Oura callback errors', () => {
  it.each(['TimeoutError', 'AbortError'])('returns a safe timeout for %s', async (name) => {
    const error = new Error('synthetic-sensitive-provider-detail');
    error.name = name;
    vi.mocked(fetch).mockRejectedValue(error);
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=error&reason=timeout'));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(
      'synthetic-sensitive-provider-detail'
    );
  });
  it('returns a safe network failure without leaking provider details', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('synthetic-sensitive-provider-detail'));
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=error&reason=network_error'));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(
      'synthetic-sensitive-provider-detail'
    );
  });
  it('rejects unsuccessful token exchange without echoing its body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('synthetic-sensitive-provider-detail', { status: 400 })
    );
    await expect(GET(request())).rejects.toThrow(
      redirectTo('oura=error&reason=token_exchange_failed')
    );
    expect(mocks.save).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(
      'synthetic-sensitive-provider-detail'
    );
  });
  it('rejects malformed token JSON before saving credentials', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('not-json'));
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=error&reason=invalid_response'));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([
    ['TimeoutError', 'timeout'],
    ['TypeError', 'network_error'],
  ])('handles %s while reading the token body safely', async (name, reason) => {
    const response = Response.json({});
    const error =
      name === 'TypeError'
        ? new TypeError('synthetic body failure')
        : new Error('synthetic body failure');
    error.name = name;
    vi.spyOn(response, 'json').mockRejectedValue(error);
    vi.mocked(fetch).mockResolvedValue(response);
    await expect(GET(request())).rejects.toThrow(redirectTo(`oura=error&reason=${reason}`));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { access_token: 'a', refresh_token: 'r', expires_in: -1 },
    { access_token: 'a', refresh_token: 'r', expires_in: 1e20 },
    { access_token: 'a', expires_in: 3600 },
  ])('rejects an invalid token response %#', async (body) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(body));
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=error&reason=invalid_response'));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([
    ['error=access_denied', 'access_denied'],
    ['error=synthetic-sensitive-provider-detail', 'provider_error'],
    ['state=synthetic-state', 'missing_code'],
    ['code=synthetic-code&state=mismatch', 'invalid_state'],
  ])('returns to the same integration for %s', async (params, reason) => {
    await expect(GET(request(params))).rejects.toThrow(redirectTo(`oura=error&reason=${reason}`));
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.cookieResponse!.cookies.get('oura_oauth_state')).toMatchObject({
      path: '/api/oura',
      maxAge: 0,
    });
  });
  it('rejects missing state even when the callback includes a code', async () => {
    mocks.expectedState = null;
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=error&reason=invalid_state'));
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    'synthetic-state',
    'not-json',
    JSON.stringify({ state: 'synthetic-state' }),
    JSON.stringify({ state: 'synthetic-state', userId: null }),
    JSON.stringify({ state: '', userId: 'synthetic-owner' }),
  ])('rejects legacy or malformed account bindings %# before exchanging tokens', async (stored) => {
    mocks.expectedState = stored;
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=error&reason=invalid_state'));
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.cookieResponse!.headers.get('set-cookie')).toContain('Path=/api/oura');
    expect(mocks.cookieResponse!.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  it('rejects an authorization begun by another account before exchange or patient writes', async () => {
    const { GET: start } = await import('../start/route');
    const response = await start(new NextRequest('https://example.test/api/oura/start'));
    const state = new URL(response.headers.get('location')!).searchParams.get('state')!;
    mocks.expectedState = response.cookies.get('oura_oauth_state')!.value;
    mocks.userId = 'another-synthetic-account';
    await expect(GET(request(`code=synthetic-code&state=${state}`))).rejects.toThrow(
      redirectTo('oura=error&reason=invalid_state')
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.cookieResponse!.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  it('completes a newly issued account-bound flow for its initiating account', async () => {
    const { GET: start } = await import('../start/route');
    const response = await start(new NextRequest('https://example.test/api/oura/start'));
    const state = new URL(response.headers.get('location')!).searchParams.get('state')!;
    mocks.expectedState = response.cookies.get('oura_oauth_state')!.value;
    await expect(GET(request(`code=synthetic-code&state=${state}`))).rejects.toThrow(
      redirectTo('oura=connected&initial_sync=success')
    );
    expect(mocks.save).toHaveBeenCalledWith('synthetic-owner', 'oura', expect.any(Object));
    expect(mocks.sync).toHaveBeenCalledWith('synthetic-owner', 'synthetic-access', true);
  });
  it('serializes an expired Secure state cookie on the original path in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=connected&initial_sync=success'));
    const header = mocks.cookieResponse!.headers.get('set-cookie')!;
    expect(header).toContain('Path=/api/oura');
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Secure');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=lax');
  });
  it('returns setup failures to the Oura integration', async () => {
    mocks.configured = false;
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=error&reason=config_error'));
  });
  it('preserves the integration destination through reauthentication', async () => {
    mocks.userId = null;
    await expect(GET(request())).rejects.toThrow(
      `redirect:/login?redirect=${encodeURIComponent('/settings?tab=integrations#oura')}`
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports storage failure without starting backfill', async () => {
    mocks.save.mockRejectedValue(new Error('synthetic storage failure'));
    await expect(GET(request())).rejects.toThrow(redirectTo('oura=error&reason=save_failed'));
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});

describe('Oura authorization start destination', () => {
  it('sends missing-configuration errors to the Oura integration', async () => {
    mocks.configured = false;
    const { GET: start } = await import('../start/route');
    const response = await start(new NextRequest('https://example.test/api/oura/start'));
    expect(response.headers.get('location')).toBe(
      'https://example.test/settings?tab=integrations&oura=error&reason=config_error#oura'
    );
  });
  it('preserves the integration destination through login', async () => {
    mocks.userId = null;
    const { GET: start } = await import('../start/route');
    const response = await start(new NextRequest('https://example.test/api/oura/start'));
    const target = new URL(response.headers.get('location')!);
    expect(target.pathname).toBe('/login');
    expect(target.searchParams.get('redirect')).toBe('/settings?tab=integrations#oura');
  });
  it('keeps the provider callback URI and CSRF cookie safeguards', async () => {
    const { GET: start } = await import('../start/route');
    const response = await start(new NextRequest('https://example.test/api/oura/start'));
    const target = new URL(response.headers.get('location')!);
    expect(target.origin).toBe('https://cloud.ouraring.com');
    expect(target.searchParams.get('redirect_uri')).toBe('https://example.test/api/oura/callback');
    expect(target.searchParams.get('state')).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(response.cookies.get('oura_oauth_state')!.value)).toEqual({
      state: target.searchParams.get('state'),
      userId: 'synthetic-owner',
    });
    expect(response.cookies.get('oura_oauth_state')).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/oura',
      maxAge: 600,
    });
  });
});
