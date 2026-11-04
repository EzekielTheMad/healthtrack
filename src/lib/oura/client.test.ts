import { afterEach, describe, expect, it, vi } from 'vitest';
import { OuraClient } from './client';
import { OuraApiError, retryAfterAt } from './errors';

afterEach(() => vi.restoreAllMocks());
describe('OuraClient endpoint semantics', () => {
  it('uses inclusive daily dates and paginates', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'a', day: '2026-09-01' }], next_token: 'next' })
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'b', day: '2026-09-02' }], next_token: null })
      );
    await expect(
      new OuraClient('synthetic').getDailyActivity('2026-09-01', '2026-09-07')
    ).resolves.toHaveLength(2);
    expect(new URL(fetch.mock.calls[0][0] as string).search).toContain('start_date=2026-09-01');
    expect(new URL(fetch.mock.calls[0][0] as string).search).toContain('end_date=2026-09-07');
    expect(new URL(fetch.mock.calls[1][0] as string).search).toContain('next_token=next');
  });
});
describe('Oura safe provider requests', () => {
  const permissionMessage =
    'Oura denied access to one or more data types. Available data can still sync; review the permissions granted to HealthTrack in Oura.';

  it.each([
    [401, { detail: 'Token is not authorized access daily scope' }],
    [401, { detail: 'Token is not authorized access synthetic-unavailable-data scope.' }],
    [401, { error: 'insufficient_scope' }],
    [401, { error: 'invalid_scope' }],
    [403, { error: 'insufficient_scope' }],
    [403, { title: 'Missing Scopes' }],
    [403, { title: 'Insufficient Scope' }],
  ])('keeps an explicit permission denial separate from expiry (%s, %j)', async (status, body) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body, { status }));
    const refresh = vi.fn().mockResolvedValue('rotated');
    await expect(
      new OuraClient('valid', refresh).getDailyResilience('2026-10-01', '2026-10-02')
    ).rejects.toMatchObject({ status, code: 'insufficient_scope', message: permissionMessage });
    expect(refresh).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('recognizes a permission denial after one refresh without refreshing again', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ error: 'invalid_token' }, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({ detail: 'Token is not authorized access daily scope' }, { status: 401 })
      );
    const refresh = vi.fn().mockResolvedValue('rotated');
    await expect(
      new OuraClient('old', refresh).getDailyResilience('2026-10-01', '2026-10-02')
    ).rejects.toMatchObject({
      status: 401,
      code: 'insufficient_scope',
      message: permissionMessage,
    });
    expect(refresh).toHaveBeenCalledExactlyOnceWith('old');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never echoes the scope name or other sensitive provider fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          detail: 'Token is not authorized access synthetic-sensitive-scope scope',
          access_token: 'synthetic-sensitive-token',
          user: 'synthetic-sensitive-user',
        },
        { status: 401 }
      )
    );
    const refresh = vi.fn();
    const error = await new OuraClient('valid', refresh)
      .getDailyResilience('2026-10-01', '2026-10-02')
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'insufficient_scope', message: permissionMessage });
    expect(String(error)).not.toContain('synthetic-sensitive');
    expect(JSON.stringify(error)).not.toContain('synthetic-sensitive');
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    { detail: 'An unrelated scope problem occurred' },
    { detail: 'prefix Token is not authorized access daily scope' },
    { detail: 'Token is not authorized access daily scope suffix' },
    { detail: 'Token is not authorized access daily\nprivate scope' },
    { detail: `Token is not authorized access ${'x'.repeat(161)} scope` },
    { detail: 'insufficient_scope' },
  ])('does not infer token permissions from generic or malformed detail (%j)', async (body) => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(body, { status: 401 }))
      .mockResolvedValueOnce(Response.json(body, { status: 401 }));
    const refresh = vi.fn().mockResolvedValue('rotated');
    await expect(
      new OuraClient('old', refresh).getDailyResilience('2026-10-01', '2026-10-02')
    ).rejects.toMatchObject({ status: 401, code: 'auth_required' });
    expect(refresh).toHaveBeenCalledExactlyOnceWith('old');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not treat a provider failure as a permission denial based on its body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ error: 'insufficient_scope' }, { status: 503 })
    );
    const refresh = vi.fn();
    await expect(
      new OuraClient('valid', refresh).getDailyResilience('2026-10-01', '2026-10-02')
    ).rejects.toMatchObject({ status: 503, code: 'provider_unavailable' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes and retries once on an unexpected access-token 401', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('sensitive provider body', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: [], next_token: null }));
    const refresh = vi.fn().mockResolvedValue('rotated');
    await expect(
      new OuraClient('old', refresh).getSpO2('2026-10-01', '2026-10-02')
    ).resolves.toEqual([]);
    expect(refresh).toHaveBeenCalledExactlyOnceWith('old');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1]?.headers).toEqual({ Authorization: 'Bearer rotated' });
  });
  it('does not loop on a repeated 401 or echo a provider body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('secret-body', { status: 401 }));
    const refresh = vi.fn().mockResolvedValue('rotated');
    const result = new OuraClient('old', refresh).getSpO2('2026-10-01', '2026-10-02');
    await expect(result).rejects.toMatchObject({ status: 401, code: 'auth_required' });
    await expect(result).rejects.not.toThrow(/secret-body/);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('retains a rate-limit retry deadline without retrying immediately', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '120' } }));
    const before = Date.now();
    try {
      await new OuraClient('old').getSpO2('2026-10-01', '2026-10-02');
      throw new Error('expected rate limit');
    } catch (error) {
      expect(error).toBeInstanceOf(OuraApiError);
      expect(Date.parse((error as OuraApiError).retryAt!)).toBeGreaterThanOrEqual(before + 120_000);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('parses Retry-After seconds and HTTP dates and ignores past or malformed values', () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    expect(retryAfterAt('60', now)).toBe('2026-10-01T00:01:00.000Z');
    expect(retryAfterAt('Thu, 01 Oct 2026 00:02:00 GMT', now)).toBe('2026-10-01T00:02:00.000Z');
    expect(retryAfterAt('bad', now)).toBeNull();
    expect(retryAfterAt('2020-01-01', now)).toBeNull();
  });
});
