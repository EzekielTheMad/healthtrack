import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED, getCapabilities } from '@/lib/capabilities';
import { safeError } from '@/lib/safe-log';
import { parseVaccinePdf } from '@/lib/claude/parse-vaccine-pdf';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);

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

  // Cap expensive document parses (shared budget with lab PDFs).
  if (!checkRateLimit(`parse-pdf:${userId}`, { max: 15, windowMs: HOUR_MS })) {
    return apiError(429, 'rate_limited', 'Too many document uploads this hour. Please try again later.');
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

    if (!ALLOWED_TYPES.has(file.type)) {
      return apiError(
        400,
        'invalid_file_type',
        'Only PDF, PNG, and JPG files are accepted',
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse with Claude
    let parsedResults;
    try {
      parsedResults = await parseVaccinePdf(buffer);
    } catch (parseError) {
      safeError('Vaccine PDF parsing error', parseError);
      const message =
        parseError instanceof Error
          ? parseError.message
          : 'Failed to parse vaccine document';
      return apiError(422, 'parse_failed', message);
    }

    return NextResponse.json({ parsed: parsedResults });
  } catch (err) {
    safeError('Vaccine PDF processing error', err);
    return apiError(500, 'internal_error', 'Failed to process vaccine PDF');
  }
}
