import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED, getCapabilities } from '@/lib/capabilities';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';
import { safeError } from '@/lib/safe-log';
import { parseLabPdf } from '@/lib/claude/parse-lab';
import {
  saveUpload,
  UploadTooLargeError,
  UnsupportedUploadTypeError,
} from '@/lib/storage';

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
  if (!getCapabilities().ai) {
    return apiError(501, AI_NOT_CONFIGURED, AI_NOT_CONFIGURED);
  }

  // Cap expensive document parses (shared budget with vaccine PDFs).
  if (!checkRateLimit(`parse-pdf:${userId}`, { max: 15, windowMs: HOUR_MS })) {
    return apiError(429, 'rate_limited', 'Too many document uploads this hour. Please try again later.');
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return apiError(400, 'bad_request', 'A file is required');
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Persist to the uploads volume. The stored path keeps the legacy
    // `<userId>/<uuid>.<ext>` shape that lab_visits.source_pdf_path consumers
    // (GET /api/files, LabPdfPreview) expect. Size/type limits are enforced
    // by the storage module (10MB, PDF/PNG/JPEG).
    let storagePath: string;
    try {
      storagePath = await saveUpload(userId, buffer, { mime: file.type });
    } catch (uploadError) {
      if (uploadError instanceof UploadTooLargeError) {
        return apiError(413, 'file_too_large', 'File size must be under 10MB');
      }
      if (uploadError instanceof UnsupportedUploadTypeError) {
        return apiError(
          415,
          'invalid_file_type',
          'Only PDF, PNG, and JPG files are accepted',
        );
      }
      safeError('Storage upload error', uploadError);
      return apiError(500, 'upload_failed', 'Failed to upload file to storage');
    }

    // Parse with Claude
    let parsedResults;
    try {
      parsedResults = await parseLabPdf(buffer);
    } catch (parseError) {
      safeError('Claude parsing error', parseError);
      const message =
        parseError instanceof Error
          ? parseError.message
          : 'Failed to parse lab document';
      return apiError(422, 'parse_failed', message);
    }

    return NextResponse.json({
      parsed: parsedResults,
      storagePath,
    });
  } catch (err) {
    safeError('Lab PDF processing error', err);
    return apiError(500, 'internal_error', 'Failed to process lab PDF');
  }
}
