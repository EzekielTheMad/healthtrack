// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
function worker() {
  const events = new Map<string, (event: unknown) => void>();
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue(new Response('neutral offline')),
    put: vi.fn(),
  };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(['healthtrack-v1', 'healthtrack-public-v1', 'other-app']),
    delete: vi.fn().mockResolvedValue(true),
  };
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response('clinical data', { headers: { 'Content-Type': 'text/html' } }));
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    URL,
    Set,
    caches,
    fetch,
    self: {
      location: { origin: 'https://health.invalid' },
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
      skipWaiting: vi.fn(),
      addEventListener: (name: string, handler: (event: unknown) => void) =>
        events.set(name, handler),
    },
  });
  return { events, cache, caches, fetch };
}
describe('public-only service worker', () => {
  it.each([
    '/api/medications',
    '/labs/private.pdf',
    '/uploads/private.jpg',
    '/dashboard?_rsc=private',
    '/api/document.js',
    '/_next/static/app.js?token=secret',
  ])('does not intercept or cache protected/resource-looking request %s', (path) => {
    const { events, cache } = worker();
    const respondWith = vi.fn();
    events.get('fetch')!({
      request: { method: 'GET', mode: 'cors', url: `https://health.invalid${path}` },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
  it('never caches authenticated navigation HTML and falls back only to neutral page', async () => {
    const { events, cache, fetch } = worker();
    let result: Promise<Response> | undefined;
    const event = {
      request: { method: 'GET', mode: 'navigate', url: 'https://health.invalid/medications' },
      respondWith: (value: Promise<Response>) => {
        result = value;
      },
    };
    events.get('fetch')!(event);
    expect(await (await result!).text()).toBe('clinical data');
    expect(cache.put).not.toHaveBeenCalled();
    fetch.mockRejectedValueOnce(new Error('offline'));
    events.get('fetch')!(event);
    expect(await (await result!).text()).toBe('neutral offline');
    expect(cache.match).toHaveBeenCalledWith('/offline.html');
  });
  it('clears only its own known caches and provides no background-write handler', async () => {
    const { events, caches } = worker();
    let result: Promise<void> | undefined;
    events.get('activate')!({
      waitUntil: (value: Promise<void>) => {
        result = value;
      },
    });
    await result;
    expect(caches.delete.mock.calls).toEqual([['healthtrack-v1'], ['healthtrack-public-v1']]);
    expect(events.has('sync')).toBe(false);
  });
});
