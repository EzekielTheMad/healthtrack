// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  seedAiConfiguration,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
const mocks = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('@/lib/auth/session', () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireUser: async () => ({ id: OWNER }) };
});
vi.mock('@/lib/claude/parse-vaccine-pdf', () => ({ parseVaccinePdf: mocks.parse }));
let ctx: RepoTestDb;
let route: typeof import('./route');
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-vaccine-ledger-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  insertDependent(ctx.sqlite, 'child', OWNER);
  insertDependent(ctx.sqlite, 'other-child', STRANGER);
  seedAiConfiguration(ctx.sqlite, OWNER);
  route = await import('./route');
  mocks.parse
    .mockReset()
    .mockResolvedValue({
      vaccines: [
        {
          name: 'Fictional vaccine',
          vaccine_date: '2024-05',
          dose_number: 1,
          series_doses: 2,
          manufacturer: null,
          lot_number: null,
          notes: null,
        },
      ],
    });
});
afterEach(() => ctx.restore());
function upload(dependent?: string, bytes: Uint8Array = new Uint8Array([0xff, 0xd8, 0xff])) {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], 'fictional.jpg', { type: '' }));
  if (dependent) form.append('dependent_id', dependent);
  return new NextRequest('http://localhost/api/parse-vaccine-pdf', { method: 'POST', body: form });
}
describe('saved vaccine extraction review', () => {
  it('stages partial dates/provenance, reuses repeated uploads and commits only an explicit exact date', async () => {
    const first = await route.POST(upload('child'));
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.batch.items[0].payload).toMatchObject({
      vaccine_date: '2024-05',
      ai_provenance: { provider: 'anthropic', configuration_revision: 'test-ai-v1' },
    });
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM vaccines').get()).toEqual({ n: 0 });
    const repeat = await (await route.POST(upload('child'))).json();
    expect(repeat.batch_id).toBe(body.batch_id);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    const { commitImportBatch } = await import('@/lib/import/batches');
    const id = body.batch.items[0].id;
    const held = await commitImportBatch(OWNER, body.batch_id, {
      decisions: [{ item_id: id, action: 'add' }],
    });
    expect(held.counts.error).toBe(1);
    await commitImportBatch(OWNER, body.batch_id, {
      decisions: [{ item_id: id, action: 'add', values: { vaccine_date: '2024-05-12' } }],
    });
    await commitImportBatch(OWNER, body.batch_id, {
      decisions: [{ item_id: id, action: 'add', values: { vaccine_date: '2024-05-12' } }],
    });
    expect(ctx.sqlite.prepare('SELECT vaccine_date,dependent_id FROM vaccines').all()).toEqual([
      { vaccine_date: '2024-05-12', dependent_id: 'child' },
    ]);
  });
  it('refuses a foreign dependent before spending and validates actual file bytes', async () => {
    expect((await route.POST(upload('other-child'))).status).toBe(404);
    expect(
      (await route.POST(upload(undefined, new TextEncoder().encode('not-an-image')))).status
    ).toBe(415);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
