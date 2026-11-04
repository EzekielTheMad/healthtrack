import { z } from 'zod';
import { FitnessWriteError } from '@/lib/repos/_fitness';
import { MAX_SCAN_BYTES } from './scans';

export const scanCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};
export async function scanJson(request: Request): Promise<unknown> {
  if (!request.body) throw new FitnessWriteError('Request body must be valid JSON.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_SCAN_BYTES) {
        await reader.cancel();
        throw new FitnessWriteError('A scan must not exceed 128 KiB.');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new FitnessWriteError('Request body must be valid JSON.');
  }
}
export function scanListOptions(params: URLSearchParams) {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(params.get('limit') ?? '25');
  const source = params.get('source') ?? undefined;
  if (source !== undefined) z.string().trim().min(1).max(100).parse(source);
  return { limit, source };
}
export function rejectPatSubject(params: URLSearchParams) {
  if (params.has('dependent_id') || params.has('owner_id'))
    throw new FitnessWriteError('PAT scan access is self-scoped.');
}
