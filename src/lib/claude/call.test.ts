import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createMessage } from './call';
import { FALLBACK_MODEL } from './model';

function notFoundError(model: string) {
  return new Anthropic.NotFoundError(
    404,
    { type: 'error', error: { type: 'not_found_error', message: `model: ${model}` } },
    `model: ${model}`,
    new Headers(),
  );
}

function fakeClient(create: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { create } } as unknown as Anthropic;
}

const OK = { id: 'msg_1', content: [{ type: 'text', text: 'ok' }] };

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe('createMessage fallback wrapper', () => {
  it('passes through a successful call untouched', async () => {
    const create = vi.fn().mockResolvedValue(OK);
    const res = await createMessage(fakeClient(create), {
      model: 'claude-retired-model',
      max_tokens: 10,
      messages: [],
    } as never);
    expect(res).toBe(OK);
    expect(create).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('retries once on FALLBACK_MODEL when the model 404s, and warns', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(notFoundError('claude-retired-model'))
      .mockResolvedValueOnce(OK);
    const res = await createMessage(fakeClient(create), {
      model: 'claude-retired-model',
      max_tokens: 10,
      messages: [],
    } as never);
    expect(res).toBe(OK);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].model).toBe(FALLBACK_MODEL);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0][0])).toContain('claude-retired-model');
    expect(String(warnSpy.mock.calls[0][0])).toContain('ANTHROPIC_MODEL');
  });

  it('does not retry when the failing model already IS the fallback', async () => {
    const create = vi.fn().mockRejectedValue(notFoundError(FALLBACK_MODEL));
    await expect(
      createMessage(fakeClient(create), {
        model: FALLBACK_MODEL,
        max_tokens: 10,
        messages: [],
      } as never),
    ).rejects.toBeInstanceOf(Anthropic.NotFoundError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-404 errors without retrying', async () => {
    const rateLimit = new Anthropic.RateLimitError(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
      'slow down',
      new Headers(),
    );
    const create = vi.fn().mockRejectedValue(rateLimit);
    await expect(
      createMessage(fakeClient(create), {
        model: 'claude-retired-model',
        max_tokens: 10,
        messages: [],
      } as never),
    ).rejects.toBeInstanceOf(Anthropic.RateLimitError);
    expect(create).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
