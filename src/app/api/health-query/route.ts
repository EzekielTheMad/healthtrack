import { AiError } from '@/lib/ai/errors';
import { aiProvenance } from '@/lib/ai/types';
import {
  hasAiConfiguration,
  resolveAiConfiguration,
  assertCurrentAiConfiguration,
} from '@/lib/ai/settings';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED } from '@/lib/capabilities';
import { AI_DISCLAIMER } from '@/lib/ai-disclaimer';
import { queryHealthData } from '@/lib/claude/query';
import {
  buildHealthContext,
  contextForPrompt,
  contextDaysSchema,
  validateAnswerReferences,
  queryContextMetadata,
} from '@/lib/health-context';
import { createQueryHistoryEntry, listQueryHistory } from '@/lib/repos/query-history';
import { rowToSnake } from '@/lib/api/snake';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';
import { safeError } from '@/lib/safe-log';

const requestSchema = z
  .object({
    query: z.string().trim().min(1).max(8000),
    dependent_id: z.string().min(1).nullable().optional(),
    days: contextDaysSchema.optional().default(90),
    force: z.boolean().optional().default(false),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!hasAiConfiguration(user.id)) return apiError(501, AI_NOT_CONFIGURED, AI_NOT_CONFIGURED);
    let body: z.infer<typeof requestSchema>;
    try {
      body = requestSchema.parse(await request.json());
    } catch {
      return apiError(400, 'invalid_query', 'Provide a question and a 30, 90, or 365-day window.');
    }
    const config = resolveAiConfiguration(user.id);
    const provenance = aiProvenance(config);
    const snapshot = await buildHealthContext(user.id, body.dependent_id ?? null, body.days);
    if (!body.force) {
      const saved = (await listQueryHistory(user.id)).find(
        (entry) =>
          entry.queryText.trim().toLowerCase() === body.query.toLowerCase() &&
          entry.contextMetadata?.fingerprint === snapshot.fingerprint &&
          entry.contextMetadata?.ai?.configuration_revision === config.revision &&
          (entry.dependentId ?? null) === (body.dependent_id ?? null)
      );
      if (saved) return NextResponse.json({ ...rowToSnake(saved), reused: true });
    }
    if (!checkRateLimit(`health-query:${user.id}`, { max: 30, windowMs: HOUR_MS }))
      return apiError(
        429,
        'rate_limited',
        'You have exceeded 30 queries this hour. Please try again later.'
      );
    let answer: string;
    try {
      answer = await queryHealthData(body.query, contextForPrompt(snapshot, body.query), config);
    } catch (error) {
      if (error instanceof Error && /timeout|ETIMEDOUT|AbortError/i.test(error.message))
        return apiError(504, 'ai_timeout', 'The query timed out. Please try again.');
      throw error;
    }
    const metadata = { ...queryContextMetadata(snapshot), ai: provenance };
    assertCurrentAiConfiguration(config);
    const responseText = `${validateAnswerReferences(answer, snapshot.evidence)}\n\n⚠️ ${AI_DISCLAIMER}`;
    try {
      const saved = await createQueryHistoryEntry(user.id, {
        queryText: body.query,
        responseText,
        dependentId: body.dependent_id ?? null,
        contextMetadata: metadata,
        aiConfiguration: config,
      });
      return NextResponse.json(rowToSnake(saved));
    } catch (error) {
      if (error instanceof AiError) throw error;
      safeError('Failed to save query history', error);
      return NextResponse.json({
        id: '',
        user_id: user.id,
        dependent_id: body.dependent_id ?? null,
        query_text: body.query,
        response_text: responseText,
        created_at: new Date().toISOString(),
        context_metadata: metadata,
      });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
