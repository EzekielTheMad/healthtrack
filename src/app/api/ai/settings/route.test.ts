// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
const state = vi.hoisted(() => ({
  id: null as string | null,
  role: 'user',
  discover: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!state.id) throw new UnauthorizedError();
      return { id: state.id, role: state.role };
    },
  };
});
vi.mock('@/lib/ai/provider', () => ({
  discoverModels: state.discover,
  generateText: state.generate,
}));
let ctx: RepoTestDb;
let route: typeof import('./route');
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-ai-api-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  state.id = OWNER;
  state.role = 'user';
  state.discover
    .mockReset()
    .mockResolvedValue([{ id: 'model-one', label: 'One', documents: 'test_required' }]);
  state.generate.mockReset().mockResolvedValue('HEALTHTRACK_TEST_OK');
  route = await import('./route');
});
afterEach(() => {
  vi.unstubAllEnvs();
  ctx.restore();
});
function request(body: unknown, origin = 'http://localhost') {
  return new Request('http://localhost/api/ai/settings', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
describe('authenticated account AI API', () => {
  it('requires authentication for reads and writes before provider access', async () => {
    state.id = null;
    expect((await route.GET()).status).toBe(401);
    expect(
      (
        await route.POST(
          request({
            action: 'discover',
            expected_revision: 'unconfigured',
            provider: 'openai',
            api_key: 'synthetic-secret-key',
          })
        )
      ).status
    ).toBe(401);
    expect(state.discover).not.toHaveBeenCalled();
  });
  it('blocks foreign origins and user-supplied account/base-URL fields', async () => {
    const body = {
      action: 'discover',
      expected_revision: 'unconfigured',
      provider: 'openai',
      api_key: 'synthetic-secret-key',
    };
    expect((await route.POST(request(body, 'https://foreign.invalid'))).status).toBe(403);
    for (const extra of [
      { user_id: STRANGER },
      { base_url: 'https://foreign.invalid' },
      { owner_id: STRANGER },
    ]) {
      const response = await route.POST(request({ ...body, ...extra }));
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain('synthetic-secret-key');
    }
    expect(state.discover).not.toHaveBeenCalled();
  });
  it('owns discover/test/save/read/remove and keeps keys write-only', async () => {
    const discovered = await (
      await route.POST(
        request({
          action: 'discover',
          expected_revision: 'unconfigured',
          provider: 'openai',
          api_key: 'synthetic-secret-key',
        })
      )
    ).json();
    expect(discovered.api_key).toBeUndefined();
    expect(
      (
        await route.POST(
          request({ action: 'test', draft_id: discovered.draft_id, primary_model: 'model-one' })
        )
      ).status
    ).toBe(200);
    const saved = await route.POST(
      request({
        action: 'save',
        expected_revision: 'unconfigured',
        draft_id: discovered.draft_id,
        primary_model: 'model-one',
      })
    );
    expect(saved.status).toBe(200);
    const value = await saved.json();
    expect(value.has_key).toBe(true);
    expect(JSON.stringify(value)).not.toContain('secret');
    const own = await route.GET();
    expect(own.headers.get('cache-control')).toBe('no-store');
    state.id = STRANGER;
    expect((await (await route.GET()).json()).has_key).toBe(false);
    expect(
      (await route.POST(request({ action: 'remove', expected_revision: value.revision }))).status
    ).toBe(409);
    state.id = OWNER;
    expect(
      (await route.POST(request({ action: 'remove', expected_revision: value.revision }))).status
    ).toBe(200);
  });
  it('legacy migration is explicit, admin-only and draft-only', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-legacy-key');
    expect((await (await route.GET()).json()).legacy_available).toBe(false);
    expect(
      (
        await route.POST(
          request({ action: 'migrate_legacy', expected_revision: 'unconfigured', confirm: true })
        )
      ).status
    ).toBe(404);
    state.role = 'admin';
    expect((await (await route.GET()).json()).legacy_available).toBe(true);
    expect(
      (
        await route.POST(
          request({ action: 'migrate_legacy', expected_revision: 'unconfigured', confirm: true })
        )
      ).status
    ).toBe(200);
    expect(state.discover).toHaveBeenCalledWith(
      'anthropic',
      'synthetic-legacy-key',
      expect.any(Function)
    );
    expect((await (await route.GET()).json()).has_key).toBe(false);
  });
});
