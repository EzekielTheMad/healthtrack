import { UnsupportedUploadTypeError } from '@/lib/storage';

/** Browser MIME is advisory: mobile uploads often send an empty/octet-stream type. */
export function detectDocumentMime(buffer: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' {
  if (buffer.subarray(0, 8).includes(Buffer.from('%PDF'))) return 'application/pdf';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  throw new UnsupportedUploadTypeError('The file contents must be PDF, PNG or JPEG.');
}
