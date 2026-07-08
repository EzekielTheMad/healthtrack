/**
 * Filesystem upload storage (replaces the hosted storage bucket).
 *
 * Files live under `UPLOADS_DIR/<ownerId>/<uuid>.<ext>`; the value persisted
 * in the database (e.g. lab_visits.source_pdf_path) is the RELATIVE path
 * `<ownerId>/<uuid>.<ext>` with forward slashes — the same shape the legacy
 * bucket used, so existing consumers keep working.
 *
 * Limits mirror the legacy bucket policy: 10MB max, PDF/PNG/JPEG only.
 * Violations throw typed errors that routes map to 413/415; reads of missing
 * or out-of-root paths throw UploadNotFoundError (mapped to 404 — a traversal
 * probe learns nothing).
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getUploadsDir } from '@/lib/runtime/paths';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

/** Canonical allowlist (parity with the legacy bucket policy). */
export const ALLOWED_UPLOAD_MIMES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** Upload exceeds the size limit → HTTP 413. */
export class UploadTooLargeError extends Error {
  readonly status = 413;
  constructor(message = `File size must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`) {
    super(message);
    this.name = 'UploadTooLargeError';
  }
}

/** Upload MIME type not in the allowlist → HTTP 415. */
export class UnsupportedUploadTypeError extends Error {
  readonly status = 415;
  constructor(message = 'Only PDF, PNG, and JPG files are accepted') {
    super(message);
    this.name = 'UnsupportedUploadTypeError';
  }
}

/**
 * Missing file OR a path that escapes the uploads root → HTTP 404.
 * Traversal attempts intentionally get the same error as a missing file.
 */
export class UploadNotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'File not found') {
    super(message);
    this.name = 'UploadNotFoundError';
  }
}

/** Browsers send image/jpg for JPEGs sometimes; treat it as image/jpeg. */
function normalizeMime(mime: string): string {
  const lower = mime.toLowerCase();
  return lower === 'image/jpg' ? 'image/jpeg' : lower;
}

/**
 * Resolve a stored relative path against the uploads root, rejecting anything
 * that would escape it. Defense in depth: segment validation first, then a
 * resolve() + prefix check.
 */
function resolveUploadPath(relPath: string): string {
  const segments = relPath.split(/[/\\]/);
  const valid =
    segments.length > 0 &&
    !path.isAbsolute(relPath) &&
    segments.every((s) => s.length > 0 && s !== '.' && s !== '..');
  if (!valid) throw new UploadNotFoundError();

  const root = path.resolve(getUploadsDir());
  const abs = path.resolve(root, segments.join(path.sep));
  if (!abs.startsWith(root + path.sep)) throw new UploadNotFoundError();
  return abs;
}

export interface SaveUploadOptions {
  /** Required when passing a Buffer; ignored for File (file.type wins). */
  mime?: string;
  /** Override the 10MB default (tests only). */
  maxBytes?: number;
  /** Override the MIME allowlist (tests only). */
  mimes?: readonly string[];
}

export interface StoredUpload {
  data: Buffer;
  mime: string;
  size: number;
}

/**
 * Validate and persist an upload for `ownerId`. Returns the relative path
 * (`<ownerId>/<uuid>.<ext>`, forward slashes) to store in the database.
 */
export async function saveUpload(
  ownerId: string,
  input: File | Buffer,
  opts: SaveUploadOptions = {},
): Promise<string> {
  // ownerId becomes a path segment; ids are server-generated, but never trust.
  if (!/^[A-Za-z0-9_-]+$/.test(ownerId)) {
    throw new Error(`saveUpload: invalid ownerId ${JSON.stringify(ownerId)}`);
  }

  const isFile = typeof File !== 'undefined' && input instanceof File;
  const rawMime = isFile ? (input as File).type : opts.mime;
  if (!rawMime) {
    throw new Error('saveUpload: mime is required when passing a Buffer');
  }
  const mime = normalizeMime(rawMime);

  const allowed = (opts.mimes ?? ALLOWED_UPLOAD_MIMES).map(normalizeMime);
  if (!allowed.includes(mime)) throw new UnsupportedUploadTypeError();

  const size = isFile ? (input as File).size : (input as Buffer).length;
  if (size > (opts.maxBytes ?? MAX_UPLOAD_BYTES)) throw new UploadTooLargeError();

  const bytes = isFile
    ? Buffer.from(await (input as File).arrayBuffer())
    : (input as Buffer);

  const ext = EXT_BY_MIME[mime] ?? 'bin';
  const relPath = `${ownerId}/${randomUUID()}.${ext}`;
  const abs = resolveUploadPath(relPath);

  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  // 'wx': never overwrite an existing file (parity with upsert: false)
  await fs.promises.writeFile(abs, bytes, { flag: 'wx' });
  return relPath;
}

/** Read a stored upload. Throws UploadNotFoundError for missing/escaping paths. */
export async function readUpload(relPath: string): Promise<StoredUpload> {
  const abs = resolveUploadPath(relPath);
  let data: Buffer;
  try {
    data = await fs.promises.readFile(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UploadNotFoundError();
    }
    throw err;
  }
  const ext = path.extname(abs).slice(1).toLowerCase();
  return {
    data,
    mime: MIME_BY_EXT[ext] ?? 'application/octet-stream',
    size: data.length,
  };
}

/** Delete a stored upload. Missing files are a no-op; escaping paths throw. */
export async function deleteUpload(relPath: string): Promise<void> {
  const abs = resolveUploadPath(relPath);
  await fs.promises.rm(abs, { force: true });
}
