// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;
let savedDataDir: string | undefined;

async function importStorage() {
  vi.resetModules();
  return import('./index');
}

beforeEach(() => {
  savedDataDir = process.env.DATA_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-storage-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const OWNER = 'owner-user-000000000000000000000';
const PDF_MAGIC = Buffer.from('%PDF-1.4 test payload');

describe('saveUpload / readUpload round-trip', () => {
  it('persists a buffer and reads back identical bytes and mime', async () => {
    const { saveUpload, readUpload } = await importStorage();
    const relPath = await saveUpload(OWNER, PDF_MAGIC, { mime: 'application/pdf' });

    expect(relPath).toMatch(
      new RegExp(`^${OWNER}/[0-9a-f-]{36}\\.pdf$`),
    );
    // stored under UPLOADS_DIR
    expect(fs.existsSync(path.join(tmpDir, 'uploads', relPath))).toBe(true);

    const stored = await readUpload(relPath);
    expect(stored.data.equals(PDF_MAGIC)).toBe(true);
    expect(stored.mime).toBe('application/pdf');
    expect(stored.size).toBe(PDF_MAGIC.length);
  });

  it('accepts a File and uses its type for the extension', async () => {
    const { saveUpload, readUpload } = await importStorage();
    const file = new File([Uint8Array.from([137, 80, 78, 71])], 'scan.png', {
      type: 'image/png',
    });
    const relPath = await saveUpload(OWNER, file);
    expect(relPath).toMatch(/\.png$/);
    const stored = await readUpload(relPath);
    expect(stored.mime).toBe('image/png');
  });

  it('normalizes image/jpg to image/jpeg', async () => {
    const { saveUpload, readUpload } = await importStorage();
    const relPath = await saveUpload(OWNER, Buffer.from('jpg-bytes'), {
      mime: 'image/jpg',
    });
    expect(relPath).toMatch(/\.jpg$/);
    expect((await readUpload(relPath)).mime).toBe('image/jpeg');
  });

  it('generates distinct paths for repeated saves (never overwrites)', async () => {
    const { saveUpload } = await importStorage();
    const a = await saveUpload(OWNER, PDF_MAGIC, { mime: 'application/pdf' });
    const b = await saveUpload(OWNER, PDF_MAGIC, { mime: 'application/pdf' });
    expect(a).not.toBe(b);
  });
});

describe('validation errors', () => {
  it('rejects oversize uploads with a 413-typed error', async () => {
    const { saveUpload, UploadTooLargeError } = await importStorage();
    const big = Buffer.alloc(11 * 1024 * 1024);
    const err = await saveUpload(OWNER, big, { mime: 'application/pdf' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(UploadTooLargeError);
    expect(err.status).toBe(413);
  });

  it('rejects disallowed mime types with a 415-typed error', async () => {
    const { saveUpload, UnsupportedUploadTypeError } = await importStorage();
    const err = await saveUpload(OWNER, Buffer.from('<svg/>'), {
      mime: 'image/svg+xml',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(UnsupportedUploadTypeError);
    expect(err.status).toBe(415);
  });

  it('rejects an ownerId that is not a safe path segment', async () => {
    const { saveUpload } = await importStorage();
    await expect(
      saveUpload('../evil', PDF_MAGIC, { mime: 'application/pdf' }),
    ).rejects.toThrow(/invalid ownerId/);
  });
});

describe('path traversal guards', () => {
  it.each([
    '../../etc/passwd',
    `${OWNER}/../../../etc/passwd`,
    '..\\..\\windows\\system32\\config',
    '/etc/passwd',
    `${OWNER}/./secret.pdf`,
    '',
  ])('readUpload(%j) throws UploadNotFoundError', async (attempt) => {
    const { readUpload, UploadNotFoundError } = await importStorage();
    await expect(readUpload(attempt)).rejects.toBeInstanceOf(UploadNotFoundError);
  });

  it('deleteUpload refuses to touch files outside the uploads root', async () => {
    const { deleteUpload, UploadNotFoundError } = await importStorage();
    // a real file outside uploads/ that a traversal would target
    const victim = path.join(tmpDir, 'keys', 'auth_secret');
    fs.mkdirSync(path.dirname(victim), { recursive: true });
    fs.writeFileSync(victim, 'secret');
    await expect(deleteUpload('../keys/auth_secret')).rejects.toBeInstanceOf(
      UploadNotFoundError,
    );
    expect(fs.existsSync(victim)).toBe(true);
  });
});

describe('missing files', () => {
  it('readUpload throws UploadNotFoundError for a well-formed missing path', async () => {
    const { readUpload, UploadNotFoundError } = await importStorage();
    const err = await readUpload(`${OWNER}/does-not-exist.pdf`).catch((e) => e);
    expect(err).toBeInstanceOf(UploadNotFoundError);
    expect(err.status).toBe(404);
  });

  it('deleteUpload is a no-op for a missing file, and removes existing ones', async () => {
    const { saveUpload, deleteUpload, readUpload, UploadNotFoundError } =
      await importStorage();
    await expect(deleteUpload(`${OWNER}/gone.pdf`)).resolves.toBeUndefined();

    const relPath = await saveUpload(OWNER, PDF_MAGIC, { mime: 'application/pdf' });
    await deleteUpload(relPath);
    await expect(readUpload(relPath)).rejects.toBeInstanceOf(UploadNotFoundError);
  });
});
