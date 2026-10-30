import { requireMobileDevice, mobileErrorResponse } from '@/lib/mobile/devices';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { safeError } from '@/lib/safe-log';
import { bodyDigest, verifySignature } from '@/lib/integrations/health-connect/signature';
import { NATIVE_MAX_BODY_BYTES } from '@/lib/integrations/health-connect/native-schema';
import {
  ingestNativeBatch,
  NativeSyncError,
} from '@/lib/integrations/health-connect/native-ingest';

export const runtime = 'nodejs';
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Paired narrow PAT + mandatory raw-body HMAC. This route never accepts
 * an owner/subject/integration ID from the client. */
export async function POST(request: Request) {
  let device: Awaited<ReturnType<typeof requireMobileDevice>>;
  try {
    device = await requireMobileDevice(request, 'write:health_connect');
  } catch (error) {
    return mobileErrorResponse(error);
  }
  if (!checkRateLimit(`native-hc:${device.id}`, { max: 600, windowMs: 3600000 }))
    return json({ error: 'rate_limited' }, 429);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > NATIVE_MAX_BODY_BYTES)
    return json({ error: 'payload_too_large' }, 413);
  let raw: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'invalid_json' }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > NATIVE_MAX_BODY_BYTES) {
        await reader.cancel();
        return json({ error: 'payload_too_large' }, 413);
      }
      chunks.push(part.value);
    }
    raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!verifySignature(raw, device.hmacSecret, request.headers.get('X-Signature')))
    return json({ error: 'invalid_signature' }, 403);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  try {
    return json(ingestNativeBatch(device, body, bodyDigest(raw)));
  } catch (error) {
    if (error instanceof NativeSyncError)
      return json({ error: error.code, message: error.message }, error.status);
    safeError('Native Health Connect delivery failed', error);
    return json({ error: 'internal_error' }, 500);
  }
}
