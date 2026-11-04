import { FitnessWriteError } from '@/lib/repos/_fitness';
/** Bound bytes before JSON parsing, including chunked requests. Never log a body. */
export async function readClinicalJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new FitnessWriteError('Send application/json.');
  const reader = request.body?.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 512 * 1024) {
        await reader.cancel();
        throw new FitnessWriteError('Clinical request exceeds 512 KiB. Split the batch.');
      }
      chunks.push(value);
    }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new FitnessWriteError('Send valid JSON.');
  }
}
export function clinicalOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  try {
    return Boolean(
      origin &&
      origin === new URL(process.env.APP_URL || request.url).origin &&
      request.headers.get('sec-fetch-site') !== 'cross-site'
    );
  } catch {
    return false;
  }
}
