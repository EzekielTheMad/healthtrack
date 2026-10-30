import { AiError } from '@/lib/ai/errors';
import { aiProvenance } from '@/lib/ai/types';
import { hasAiConfiguration, resolveAiConfiguration } from '@/lib/ai/settings';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED } from '@/lib/capabilities';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';
import { safeError } from '@/lib/safe-log';
import { parseLabPdf } from '@/lib/claude/parse-lab';
import { fileHash, findImportBatch, stageImportBatch } from '@/lib/import/batches';
import { labClaims } from '@/lib/import/claims';
import { errorResponse } from '@/lib/api/respond';
import { detectDocumentMime } from '@/lib/import/document-file';
import { saveUpload, UploadTooLargeError, UnsupportedUploadTypeError } from '@/lib/storage';

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

  // Cap expensive document parses (shared budget with vaccine PDFs).
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

    if (file.size > 10 * 1024 * 1024)
      return apiError(413, 'file_too_large', 'File size must be under 10MB');
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = detectDocumentMime(buffer);
    const dependentId =
      typeof formData.get('dependent_id') === 'string'
        ? String(formData.get('dependent_id')) || null
        : null;
    const hash = fileHash(buffer);
    const prior = await findImportBatch(userId, dependentId, hash, 'labs');
    if (prior) {
      const first = prior.items[0]?.payload;
      return NextResponse.json({
        parsed: {
          visit_date: first?.visit_date ?? null,
          provider_name: first?.provider_name ?? null,
          results: prior.items.map((item) => item.payload),
          import_batch_id: prior.id,
        },
        storagePath: prior.source_path,
        batch_id: prior.id,
        batch: prior,
      });
    }

    // Persist to the uploads volume. The stored path keeps the legacy
    // `<userId>/<uuid>.<ext>` shape that lab_visits.source_pdf_path consumers
    // (GET /api/files, LabPdfPreview) expect. Size/type limits are enforced
    // by the storage module (10MB, PDF/PNG/JPEG).
    let storagePath: string;
    try {
      storagePath = await saveUpload(userId, buffer, { mime: mimeType });
    } catch (uploadError) {
      if (uploadError instanceof UploadTooLargeError) {
        return apiError(413, 'file_too_large', 'File size must be under 10MB');
      }
      if (uploadError instanceof UnsupportedUploadTypeError) {
        return apiError(415, 'invalid_file_type', 'Only PDF, PNG, and JPG files are accepted');
      }
      safeError('Storage upload error', uploadError);
      return apiError(500, 'upload_failed', 'Failed to upload file to storage');
    }

    const config = resolveAiConfiguration(userId);
    // Parse with the selected account configuration
    let parsedResults;
    try {
      parsedResults = await parseLabPdf(buffer, config);
    } catch (parseError) {
      if (parseError instanceof AiError) return errorResponse(parseError);
      safeError('AI parsing error', parseError);
      const message =
        parseError instanceof Error ? parseError.message : 'Failed to parse lab document';
      return apiError(422, 'parse_failed', message);
    }

    const batch = await stageImportBatch(userId, dependentId, {
      hash,
      kind: 'labs',
      name: file.name,
      sourcePath: storagePath,
      items: labClaims(parsedResults).map((item) => ({
        ...item,
        payload: { ...item.payload, ai_provenance: aiProvenance(config, 'extraction') },
      })),
      aiConfiguration: config,
      warnings: parsedResults.warnings ?? [],
    });
    return NextResponse.json({
      parsed: { ...parsedResults, import_batch_id: batch.id },
      storagePath,
      batch_id: batch.id,
      batch,
    });
  } catch (err) {
    if (err instanceof UnsupportedUploadTypeError)
      return apiError(415, 'invalid_file_type', err.message);
    return errorResponse(err);
  }
}
