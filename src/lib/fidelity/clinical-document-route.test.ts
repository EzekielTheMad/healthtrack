// @vitest-environment node
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
const { call, settings, session } = vi.hoisted(() => ({
  call: vi.fn(),
  settings: { available: true },
  session: { id: 'owner' },
}));
vi.mock('@/lib/claude/call', () => ({ createMessage: call }));
vi.mock('@/lib/ai/settings', () => ({
  hasAiConfiguration: () => settings.available,
  resolveAiConfiguration: (userId: string) => ({
    userId,
    revision: 'synthetic',
    provider: 'openai',
    primaryModel: 'synthetic',
    extractionModel: 'synthetic-docs',
    apiKey: 'not-real',
  }),
  assertCurrentAiConfiguration: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({
  requireUser: async () => ({ id: session.id }),
  UnauthorizedError: class extends Error {},
}));
vi.mock('@/lib/api/rate-limit', () => ({ checkRateLimit: () => true, HOUR_MS: 3600000 }));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  saveUpload: async () => 'synthetic-user/fictional.pdf',
}));
let ctx: RepoTestDb;
function request(bytes = Buffer.from('%PDF-1.4 fictional'), origin = 'http://localhost') {
  const body = new FormData();
  body.set(
    'file',
    new File([new Uint8Array(bytes)], 'Fictional.pdf', { type: 'application/octet-stream' })
  );
  return new NextRequest('http://localhost/api/parse-lab-pdf?format=typed', {
    method: 'POST',
    headers: { origin },
    body,
  });
}
beforeEach(async () => {
  ctx = await setupRepoDb('hf-document-route-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  session.id = OWNER;
  settings.available = true;
  call.mockReset();
});
afterEach(() => ctx.restore());
it('stages detected PDF evidence and repeated uploads reopen even without provider configuration or a second call', async () => {
  call.mockResolvedValue({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          results: [
            { test_name: 'Fictional', value: 'Negative' },
            { test_name: 'Held', novel_field: 'preserved' },
          ],
        }),
      },
    ],
  });
  const route = await import('@/app/api/parse-lab-pdf/route');
  const first = await route.POST(request());
  expect(first.status).toBe(200);
  const data = await first.json();
  expect(data.typed).toBe(true);
  expect(data.document.held).toHaveLength(1);
  expect(data.batch.items[0].fact.outcome).toEqual({ kind: 'text', text: 'Negative' });
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 0 });
  settings.available = false;
  const again = await (await route.POST(request())).json();
  expect(again.reopened).toBe(true);
  expect(again.clinical_batch_id).toBe(data.clinical_batch_id);
  expect(call).toHaveBeenCalledTimes(1);
  const read = await import('@/app/api/clinical-intake/documents/[id]/route');
  session.id = STRANGER;
  expect(
    (
      await read.GET(
        new NextRequest('http://localhost/api/clinical-intake/documents/' + data.document_id),
        { params: Promise.resolve({ id: data.document_id }) }
      )
    ).status
  ).toBe(404);
});
it('retains an incomplete source after invalid JSON, returns a safe actionable error, and permits retry', async () => {
  call
    .mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }] })
    .mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"results":[{"test_name":"Retry","value":0}]}' }],
    });
  const route = await import('@/app/api/parse-lab-pdf/route');
  const failed = await route.POST(request());
  expect(failed.status).toBe(422);
  const error = await failed.json();
  expect(error.document_id).toBeTruthy();
  expect(error.message).toContain('not valid JSON');
  expect(
    ctx.sqlite.prepare('SELECT status FROM import_batches WHERE id=?').get(error.document_id)
  ).toEqual({ status: 'incomplete' });
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 0 });
  const success = await route.POST(request());
  expect(success.status).toBe(200);
  expect((await success.json()).batch.items[0].fact.outcome.value).toBe(0);
  expect(call).toHaveBeenCalledTimes(2);
});
it('prevents concurrent duplicate extraction and requires the app origin before any provider call', async () => {
  let release: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  call.mockReturnValue(pending);
  const route = await import('@/app/api/parse-lab-pdf/route');
  expect((await route.POST(request(undefined, 'http://untrusted.invalid'))).status).toBe(403);
  expect(call).not.toHaveBeenCalled();
  const first = route.POST(request());
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  expect((await route.POST(request())).status).toBe(409);
  release({
    content: [{ type: 'text', text: '{"results":[{"test_name":"Concurrent","value":0}]}' }],
  });
  expect((await first).status).toBe(200);
  expect(call).toHaveBeenCalledTimes(1);
});
