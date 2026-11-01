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
import { parseTypedLabPdf, TypedLabExtractionError } from '@/lib/claude/parse-typed-lab';
import { getSqlite } from '@/db';
import { getClinicalIntake } from '@/lib/fidelity/clinical';
import { saveTypedLabEvidence, getTypedLabEvidence } from '@/lib/fidelity/clinical-extraction';
import { clinicalOriginAllowed } from '@/lib/fidelity/clinical-http';
import { assertCurrentAiConfiguration } from '@/lib/ai/settings';
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
  const typed = request.nextUrl.searchParams.get('format') === 'typed';
  if (typed && !clinicalOriginAllowed(request))
    return apiError(
      403,
      'invalid_origin',
      'Open typed document review from this HealthTrack site.'
    );
  if (!typed && !hasAiConfiguration(userId)) {
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
    if (typed) {
      const prior = await findImportBatch(userId, dependentId, hash, 'clinical_labs');
      if (prior?.items.length) {
        const saved = getSqlite()
          .prepare(
            'SELECT id FROM clinical_intake_batches WHERE user_id=? AND dependent_id IS ? AND external_id=?'
          )
          .get(userId, dependentId, 'typed-lab:' + hash) as { id: string } | undefined;
        const rawReport = !saved
          ? (getSqlite()
              .prepare(
                "SELECT payload FROM import_items WHERE batch_id=? AND status='document_metadata' ORDER BY position DESC LIMIT 1"
              )
              .get(prior.id) as { payload: string } | undefined)
          : undefined;
        const recovered = rawReport
          ? await saveTypedLabEvidence(
              userId,
              dependentId,
              prior.id,
              JSON.parse(rawReport.payload)._hf_document_report,
              prior.file_name
            )
          : null;
        const batch = saved
          ? await getClinicalIntake(userId, saved.id)
          : (recovered?.batch ?? null);
        return NextResponse.json({
          typed: true,
          batch,
          clinical_batch_id: batch?.id ?? null,
          document: await getTypedLabEvidence(userId, prior.id),
          document_id: prior.id,
          storagePath: prior.source_path,
          reopened: true,
        });
      }
      if (!hasAiConfiguration(userId)) return apiError(501, AI_NOT_CONFIGURED, AI_NOT_CONFIGURED);
      const storagePath =
        prior?.source_path ?? (await saveUpload(userId, buffer, { mime: mimeType }));
      const source =
        prior ??
        (await stageImportBatch(userId, dependentId, {
          hash,
          kind: 'clinical_labs',
          name: file.name,
          sourcePath: storagePath,
          items: [],
          warnings: ['Typed clinical extraction is awaiting review.'],
        }));
      const lease = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const claimed = getSqlite()
        .prepare(
          "UPDATE import_batches SET status='extracting',updated_at=? WHERE id=? AND (status!='extracting' OR updated_at<?)"
        )
        .run(new Date().toISOString(), source.id, lease);
      if (!claimed.changes)
        return apiError(
          409,
          'extraction_in_progress',
          'This document is already being extracted. Reopen its saved review when it finishes; no second extraction was started.'
        );
      const config = resolveAiConfiguration(userId);
      try {
        const raw = await parseTypedLabPdf(buffer, config);
        assertCurrentAiConfiguration(config);
        const provenance = aiProvenance(config, 'extraction');
        const result = await saveTypedLabEvidence(
          userId,
          dependentId,
          source.id,
          raw,
          file.name,
          `Provider ${provenance.provider}; model ${provenance.model}; configuration ${provenance.configuration_revision}.`
        );
        return NextResponse.json({
          typed: true,
          batch: result.batch,
          clinical_batch_id: result.batch?.id ?? null,
          document: await getTypedLabEvidence(userId, source.id),
          document_id: source.id,
          storagePath,
          reopened: false,
        });
      } catch (error) {
        getSqlite()
          .prepare(
            "UPDATE import_batches SET status='incomplete',warnings=?,updated_at=? WHERE id=?"
          )
          .run(
            JSON.stringify([
              'Incomplete extraction: original source retained. No clinical result was accepted. Reopen the saved review or retry extraction.',
            ]),
            new Date().toISOString(),
            source.id
          );
        const failure =
          error instanceof TypedLabExtractionError
            ? apiError(422, 'parse_failed', error.message)
            : errorResponse(error);
        return NextResponse.json(
          { ...(await failure.json()), document_id: source.id },
          { status: failure.status }
        );
      }
    }
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
