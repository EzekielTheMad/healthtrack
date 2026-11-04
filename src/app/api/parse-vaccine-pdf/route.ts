import { AiError } from '@/lib/ai/errors';
import { aiProvenance } from '@/lib/ai/types';
import {
  hasAiConfiguration,
  resolveAiConfiguration,
  assertCurrentAiConfiguration,
} from '@/lib/ai/settings';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED } from '@/lib/capabilities';
import { detectDocumentMime } from '@/lib/import/document-file';
import { errorResponse } from '@/lib/api/respond';
import { safeError } from '@/lib/safe-log';
import { fileHash, findImportBatch, stageImportBatch } from '@/lib/import/batches';
import { saveUpload, UnsupportedUploadTypeError } from '@/lib/storage';
import { parseVaccinePdf } from '@/lib/claude/parse-vaccine-pdf';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return apiError(401, 'unauthorized', 'Authentication required');
    }
    throw err;
  }

  // Gated after auth so unauthenticated callers can't probe instance config.
  if (!hasAiConfiguration(userId)) {
    return apiError(501, AI_NOT_CONFIGURED, AI_NOT_CONFIGURED);
  }

  // Cap expensive document parses (shared budget with lab PDFs).
  if (!checkRateLimit(`parse-pdf:${userId}`, { max: 15, windowMs: HOUR_MS })) {
    return apiError(
      429,
      'rate_limited',
      'Too many document uploads this hour. Please try again later.'
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return apiError(400, 'bad_request', 'A file is required');
    }

    if (file.size > MAX_FILE_SIZE) {
      return apiError(400, 'file_too_large', 'File size must be under 10MB');
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const mimeType = detectDocumentMime(buffer);
    const dependentId =
      typeof formData.get('dependent_id') === 'string'
        ? String(formData.get('dependent_id')) || null
        : null;
    const hash = fileHash(buffer);
    const prior = await findImportBatch(userId, dependentId, hash, 'vaccines');
    if (prior)
      return NextResponse.json({
        parsed: { vaccines: prior.items.map((item) => item.payload), import_batch_id: prior.id },
        batch: prior,
        batch_id: prior.id,
      });
    const config = resolveAiConfiguration(userId);
    // Parse with selected account configuration
    let parsedResults;
    try {
      parsedResults = await parseVaccinePdf(buffer, config);
    } catch (parseError) {
      if (parseError instanceof AiError) return errorResponse(parseError);
      safeError('Vaccine PDF parsing error', parseError);
      const message =
        parseError instanceof Error ? parseError.message : 'Failed to parse vaccine document';
      return apiError(422, 'parse_failed', message);
    }

    assertCurrentAiConfiguration(config);
    const sourcePath = await saveUpload(userId, buffer, { mime: mimeType });
    const batch = await stageImportBatch(userId, dependentId, {
      hash,
      kind: 'vaccines',
      name: file.name,
      sourcePath,
      aiConfiguration: config,
      items: parsedResults.vaccines.map((payload) => ({
        domain: 'vaccines',
        payload: { ...payload, ai_provenance: aiProvenance(config, 'extraction') },
      })),
    });
    return NextResponse.json({
      parsed: { ...parsedResults, import_batch_id: batch.id },
      batch,
      batch_id: batch.id,
      ai: aiProvenance(config, 'extraction'),
    });
  } catch (err) {
    if (err instanceof AiError) return errorResponse(err);
    if (err instanceof UnsupportedUploadTypeError)
      return apiError(415, 'invalid_file_type', err.message);
    return errorResponse(err);
  }
}
