import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import { AiError } from '@/lib/ai/errors';
import { AI_PROVIDERS } from '@/lib/ai/types';
import {
  readAiSettings,
  discardAiDraft,
  refreshAiModels,
  removeAiSettings,
  saveAiDraft,
  testAiDraft,
} from '@/lib/ai/settings';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';

const revision = z.string().min(1).max(100);
const models = {
  primary_model: z.string().min(1).max(200),
  extraction_model: z.string().min(1).max(200).nullable().default(null),
};
const schema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('discover'),
      expected_revision: revision,
      provider: z.enum(AI_PROVIDERS),
      api_key: z.string().min(8).max(4096).optional(),
    })
    .strict(),
  z.object({ action: z.literal('test'), draft_id: z.string().uuid(), ...models }).strict(),
  z
    .object({
      action: z.literal('save'),
      expected_revision: revision,
      draft_id: z.string().uuid(),
      ...models,
    })
    .strict(),
  z.object({ action: z.literal('remove'), expected_revision: revision }).strict(),
  z
    .object({
      action: z.literal('discard_draft'),
      expected_revision: revision,
      draft_id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal('migrate_legacy'),
      expected_revision: revision,
      confirm: z.literal(true),
    })
    .strict(),
]);
function failure(error: unknown) {
  if (error instanceof AiError) return apiError(error.status, `ai_${error.code}`, error.message);
  if (error instanceof z.ZodError)
    return apiError(400, 'invalid_settings', 'Check the AI settings fields and try again.');
  return errorResponse(error);
}
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(
      {
        ...readAiSettings(user.id),
        legacy_available: user.role === 'admin' && Boolean(process.env.ANTHROPIC_API_KEY),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const origin = request.headers.get('origin');
    if (
      !origin ||
      origin !== new URL(process.env.APP_URL || request.url).origin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return apiError(403, 'invalid_origin', 'Open AI settings from this HealthTrack site.');
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return apiError(415, 'invalid_type', 'Send JSON settings.');
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 10_000) {
          await reader.cancel();
          return apiError(413, 'too_large', 'Settings request is too large.');
        }
        chunks.push(value);
      }
    const text = Buffer.concat(chunks).toString('utf8');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return apiError(400, 'invalid_json', 'Send valid JSON settings.');
    }
    const body = schema.parse(raw);
    if (
      ['discover', 'test', 'migrate_legacy'].includes(body.action) &&
      !checkRateLimit(`ai-settings:${user.id}`, { max: 20, windowMs: HOUR_MS })
    )
      return apiError(429, 'rate_limited', 'Too many AI setup requests. Try again later.');
    let result;
    switch (body.action) {
      case 'discover':
        result = await refreshAiModels(
          user.id,
          body.expected_revision,
          body.provider,
          body.api_key
        );
        break;
      case 'test':
        result = await testAiDraft(
          user.id,
          body.draft_id,
          body.primary_model,
          body.extraction_model
        );
        break;
      case 'save':
        result = saveAiDraft(
          user.id,
          body.expected_revision,
          body.draft_id,
          body.primary_model,
          body.extraction_model
        );
        break;
      case 'remove':
        result = removeAiSettings(user.id, body.expected_revision);
        break;
      case 'discard_draft':
        result = discardAiDraft(user.id, body.expected_revision, body.draft_id);
        break;
      case 'migrate_legacy':
        if (user.role !== 'admin') return apiError(404, 'not_found', 'Not found');
        if (!process.env.ANTHROPIC_API_KEY) throw new AiError('not_configured');
        result = await refreshAiModels(
          user.id,
          body.expected_revision,
          'anthropic',
          process.env.ANTHROPIC_API_KEY
        );
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
