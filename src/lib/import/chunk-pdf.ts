/**
 * PDF page-chunking for the medical-history importer.
 *
 * Large PDFs can't go to Claude in one document block (the API caps requests
 * at ~100 pages / 32MB), so documents over {@link CHUNK_PAGE_THRESHOLD} pages
 * are split into consecutive page-range chunks, extracted per chunk, and the
 * results merged (see merge-extractions.ts). Splitting uses pdf-lib (pure JS,
 * Node-safe): each chunk is a fresh PDFDocument containing a copied page range.
 */
import { PDFDocument } from 'pdf-lib';

/** Documents beyond this many pages are rejected outright. */
export const MAX_PAGES = 200;

/** Documents with at most this many pages are sent in a single request. */
export const CHUNK_PAGE_THRESHOLD = 30;

/** Default pages per chunk when splitting. */
export const DEFAULT_PAGES_PER_CHUNK = 25;

/** Number of pages in the PDF. Throws if the buffer is not a loadable PDF. */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: false });
  return doc.getPageCount();
}

export interface PdfChunks {
  /** Consecutive page-range sub-documents, each ≤ pagesPerChunk pages. */
  chunks: Buffer[];
  /** Total page count of the source document. */
  pageCount: number;
}

/**
 * Split a PDF into consecutive page-range chunks of at most `pagesPerChunk`
 * pages each. The final chunk holds the remainder. A document with fewer
 * pages than `pagesPerChunk` yields a single chunk.
 */
export async function splitPdfIntoChunks(
  buffer: Buffer,
  pagesPerChunk: number = DEFAULT_PAGES_PER_CHUNK,
): Promise<PdfChunks> {
  if (!Number.isInteger(pagesPerChunk) || pagesPerChunk < 1) {
    throw new Error(`pagesPerChunk must be a positive integer, got ${pagesPerChunk}`);
  }

  const source = await PDFDocument.load(buffer, { ignoreEncryption: false });
  const pageCount = source.getPageCount();

  const chunks: Buffer[] = [];
  for (let start = 0; start < pageCount; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, pageCount);
    const indices = Array.from({ length: end - start }, (_, i) => start + i);

    const chunkDoc = await PDFDocument.create();
    const pages = await chunkDoc.copyPages(source, indices);
    for (const page of pages) chunkDoc.addPage(page);

    chunks.push(Buffer.from(await chunkDoc.save()));
  }

  return { chunks, pageCount };
}
