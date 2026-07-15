/**
 * POST /api/parse-medical-history — extract a doctor-provided medical-history
 * PDF/image into structured items across six domains, annotated with a dedupe
 * status against the target profile's existing rows.
 *
 * Multipart form: `file` (PDF ≤50MB, PNG/JPG ≤10MB) + optional `dependent_id`.
 * The target scope's existing rows are loaded (which also verifies the
 * dependent belongs to the caller) BEFORE the expensive AI call. Nothing is
 * persisted — the client reviews the annotated items and submits approved
 * ones to POST /api/import-medical-history.
 *
 * Large PDFs (> CHUNK_PAGE_THRESHOLD pages, capped at MAX_PAGES) are split
 * into page chunks, extracted sequentially, and merged; chunks that fail to
 * parse surface as `warnings` instead of failing the whole document (the
 * request only fails when every chunk fails). Rate limiting stays one hit per
 * document, not per chunk.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED, getCapabilities } from '@/lib/capabilities';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';
import { safeError } from '@/lib/safe-log';
import { NotFoundError } from '@/lib/authz';
import {
  parseMedicalHistory,
  type ParsedMedicalHistory,
} from '@/lib/claude/parse-medical-history';
import { listMedications } from '@/lib/repos/medications';
import { listConditions } from '@/lib/repos/conditions';
import { listAllergies } from '@/lib/repos/allergies';
import { listProcedures } from '@/lib/repos/procedures';
import { listVaccines } from '@/lib/repos/vaccines';
import { listLabResults } from '@/lib/repos/labs';
import {
  buildLabResultIndex,
  buildNameDateIndex,
  buildNameIndex,
  dedupeByName,
  dedupeByNameDate,
  dedupeLabResult,
  type DedupeStatus,
} from '@/lib/import/dedupe';
import {
  CHUNK_PAGE_THRESHOLD,
  MAX_PAGES,
  getPdfPageCount,
  splitPdfIntoChunks,
} from '@/lib/import/chunk-pdf';
import { mergeExtractions } from '@/lib/import/merge-extractions';

// Chunked extraction of a large PDF can take several minutes.
export const maxDuration = 600;

const MAX_PDF_FILE_SIZE = 50 * 1024 * 1024; // 50MB (page-chunked)
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024; // 10MB (single-shot)
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);

type WithStatus<T> = T & { dedupe_status: DedupeStatus };

export interface MedicalHistoryReviewItems {
  medications: WithStatus<ParsedMedicalHistory['medications'][number]>[];
  conditions: WithStatus<ParsedMedicalHistory['conditions'][number]>[];
  allergies: WithStatus<ParsedMedicalHistory['allergies'][number]>[];
  procedures: WithStatus<ParsedMedicalHistory['procedures'][number]>[];
  vaccines: WithStatus<ParsedMedicalHistory['vaccines'][number]>[];
  lab_visits: {
    visit_date: string;
    results: WithStatus<
      ParsedMedicalHistory['lab_visits'][number]['results'][number]
    >[];
  }[];
}

export interface ParseMedicalHistoryResponse {
  items: MedicalHistoryReviewItems;
  /** Total PDF page count (absent for images). */
  page_count?: number;
  /** Non-fatal problems, e.g. page ranges that could not be processed. */
  warnings?: string[];
}

const PAGES_PER_CHUNK = 25;

class PdfTooLongError extends Error {
  constructor(pageCount: number) {
    super(
      `This document has ${pageCount} pages — the importer supports up to ${MAX_PAGES}. Please split it and import in parts.`,
    );
    this.name = 'PdfTooLongError';
  }
}

/** Human-readable label for a chunk's 1-based page range. */
function pageRangeLabel(startPage: number, endPage: number): string {
  return startPage === endPage
    ? `Page ${startPage}`
    : `Pages ${startPage}–${endPage}`;
}

/**
 * Extract a PDF, page-chunking when it exceeds CHUNK_PAGE_THRESHOLD pages.
 * Chunks are extracted sequentially (cost / rate-limit safety); a failed
 * chunk becomes a warning and extraction continues. Throws only when the
 * document is unreadable, too long, or every chunk fails.
 */
async function extractPdf(buffer: Buffer): Promise<{
  parsed: ParsedMedicalHistory;
  pageCount: number;
  warnings: string[];
}> {
  const pageCount = await getPdfPageCount(buffer);

  if (pageCount > MAX_PAGES) {
    throw new PdfTooLongError(pageCount);
  }

  if (pageCount <= CHUNK_PAGE_THRESHOLD) {
    // Small document — single-shot with the original buffer, no chunking.
    const parsed = await parseMedicalHistory(buffer, 'application/pdf');
    return { parsed, pageCount, warnings: [] };
  }

  const { chunks } = await splitPdfIntoChunks(buffer, PAGES_PER_CHUNK);
  const parts: ParsedMedicalHistory[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const startPage = i * PAGES_PER_CHUNK + 1;
    const endPage = Math.min((i + 1) * PAGES_PER_CHUNK, pageCount);
    try {
      parts.push(await parseMedicalHistory(chunks[i], 'application/pdf'));
    } catch (err) {
      safeError(
        `Medical history chunk extraction failed (pages ${startPage}-${endPage})`,
        err,
      );
      warnings.push(`${pageRangeLabel(startPage, endPage)} could not be processed`);
    }
  }

  if (parts.length === 0) {
    throw new Error('Failed to parse medical history document');
  }

  return { parsed: mergeExtractions(parts), pageCount, warnings };
}

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

  // Cap expensive document parses (shared budget with lab/vaccine PDFs).
  if (!checkRateLimit(`parse-pdf:${userId}`, { max: 15, windowMs: HOUR_MS })) {
    return apiError(429, 'rate_limited', 'Too many document uploads this hour. Please try again later.');
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return apiError(400, 'bad_request', 'A file is required');
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return apiError(
        400,
        'invalid_file_type',
        'Only PDF, PNG, and JPG files are accepted',
      );
    }

    const isPdf = file.type === 'application/pdf';
    if (file.size > (isPdf ? MAX_PDF_FILE_SIZE : MAX_IMAGE_FILE_SIZE)) {
      return apiError(
        400,
        'file_too_large',
        isPdf ? 'PDF size must be under 50MB' : 'Image size must be under 10MB',
      );
    }

    const dependentIdRaw = formData.get('dependent_id');
    const dependentId =
      typeof dependentIdRaw === 'string' && dependentIdRaw.length > 0
        ? dependentIdRaw
        : null;

    // Load the target scope's existing rows first — this also verifies the
    // dependent belongs to the caller (authz → 404) before we spend an AI call.
    const scope = { ownerId: userId, dependentId };
    let existing;
    try {
      const [medications, conditions, allergies, procedures, vaccines, labResults] =
        await Promise.all([
          listMedications(userId, scope),
          listConditions(userId, scope),
          listAllergies(userId, scope),
          listProcedures(userId, scope),
          listVaccines(userId, scope),
          listLabResults(userId, scope),
        ]);
      existing = { medications, conditions, allergies, procedures, vaccines, labResults };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return apiError(404, 'not_found', 'Not found');
      }
      throw err;
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Parse with Claude (PDFs page-chunk when large; images are single-shot).
    let parsed: ParsedMedicalHistory;
    let pageCount: number | undefined;
    let warnings: string[] = [];
    try {
      if (isPdf) {
        const result = await extractPdf(buffer);
        parsed = result.parsed;
        pageCount = result.pageCount;
        warnings = result.warnings;
      } else {
        parsed = await parseMedicalHistory(buffer, file.type);
      }
    } catch (parseError) {
      if (parseError instanceof PdfTooLongError) {
        return apiError(400, 'too_many_pages', parseError.message);
      }
      safeError('Medical history parsing error', parseError);
      const message =
        parseError instanceof Error
          ? parseError.message
          : 'Failed to parse medical history document';
      return apiError(422, 'parse_failed', message);
    }

    // Annotate each extracted item with its dedupe status.
    const medicationIndex = buildNameIndex(existing.medications.map((m) => m.name));
    const conditionIndex = buildNameIndex(existing.conditions.map((c) => c.name));
    const allergyIndex = buildNameIndex(existing.allergies.map((a) => a.name));
    const procedureIndex = buildNameDateIndex(
      existing.procedures.map((p) => ({ name: p.name, date: p.procedureDate })),
    );
    const vaccineIndex = buildNameDateIndex(
      existing.vaccines.map((v) => ({ name: v.name, date: v.vaccineDate })),
    );
    const labIndex = buildLabResultIndex(
      existing.labResults.map((r) => ({
        visitDate: r.visitDate,
        testName: r.testName,
      })),
    );

    const items: MedicalHistoryReviewItems = {
      medications: parsed.medications.map((m) => ({
        ...m,
        dedupe_status: dedupeByName(m.name, medicationIndex),
      })),
      conditions: parsed.conditions.map((c) => ({
        ...c,
        dedupe_status: dedupeByName(c.name, conditionIndex),
      })),
      allergies: parsed.allergies.map((a) => ({
        ...a,
        dedupe_status: dedupeByName(a.name, allergyIndex),
      })),
      procedures: parsed.procedures.map((p) => ({
        ...p,
        dedupe_status: dedupeByNameDate(p.name, p.procedure_date, procedureIndex),
      })),
      vaccines: parsed.vaccines.map((v) => ({
        ...v,
        dedupe_status: dedupeByNameDate(v.name, v.vaccine_date, vaccineIndex),
      })),
      lab_visits: parsed.lab_visits.map((visit) => ({
        visit_date: visit.visit_date,
        results: visit.results.map((r) => ({
          ...r,
          dedupe_status: dedupeLabResult(visit.visit_date, r.test_name, labIndex),
        })),
      })),
    };

    const response: ParseMedicalHistoryResponse = { items };
    if (pageCount !== undefined) response.page_count = pageCount;
    if (warnings.length > 0) response.warnings = warnings;
    return NextResponse.json(response);
  } catch (err) {
    safeError('Medical history processing error', err);
    return apiError(500, 'internal_error', 'Failed to process medical history document');
  }
}
