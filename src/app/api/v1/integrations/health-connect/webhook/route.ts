/**
 * POST /api/v1/integrations/health-connect/webhook — Life Dashboard receiver.
 *
 * Processing order is load-bearing (PRD §6.2):
 *   1. read the EXACT raw body as text (never request.json() first — the
 *      HMAC covers the bytes the phone sent, and re-serializing parsed JSON
 *      changes key order, number formatting and whitespace);
 *   2. enforce the body-size limit;
 *   3. validate the PAT and require write:health_connect;
 *   4. load the caller's integration and reject paused/errored ones;
 *   5. verify X-Signature (constant time) — required in production;
 *   6. parse JSON, validate the envelope;
 *   7. persist raw + normalize in ONE transaction;
 *   8. only then return 200.
 *
 * The companion retries network errors, timeouts, 408, 429 and 5xx, so a 2xx
 * is never returned before the transaction commits.
 *
 * Logging: ingest ids and safe counts only. Never the bearer token, the HMAC
 * secret, the signature header, or any health value (PRD §6.9).
 */
import { NextRequest } from 'next/server';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { safeError } from '@/lib/safe-log';
import {
  EnvelopeError,
  ingestEnvelope,
  recordTestPing,
  type IngestResult,
} from '@/lib/integrations/health-connect/ingest';
import { isTestPing, maxBodyBytes } from '@/lib/integrations/health-connect/schema';
import {
  SIGNATURE_HEADER,
  allowsUnsigned,
  bodyDigest,
  verifySignature,
} from '@/lib/integrations/health-connect/signature';
import { findIntegrationRow, integrationSecret } from '@/lib/repos/health-connect';
import { db } from '@/db';

const SCOPE = 'write:health_connect';

/** Per-token/user/integration budget. A phone on the shortest supported sync
    interval sends a few payloads an hour; 240/hour leaves ample headroom for
    a backfill burst while still bounding abuse. */
const RATE_LIMIT = { max: 240, windowMs: 60 * 60 * 1000 };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Signature',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  // 1. Raw bytes first — before any parsing.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: 'Request body could not be read' }, 400);
  }

  // 2. Size limit. Measured in BYTES (Buffer.byteLength), not characters, so
  // multi-byte payloads cannot slip past the cap.
  const limit = maxBodyBytes();
  if (Buffer.byteLength(rawBody, 'utf8') > limit) {
    return json({ error: `Payload too large — the limit is ${limit} bytes` }, 413);
  }

  // 3. PAT.
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, SCOPE)) return forbidden(SCOPE);

  // 4. Rate limit, keyed by token AND user (one bucket per PAT, plus a
  // per-user ceiling so extra tokens do not multiply the budget).
  for (const key of [`hc-webhook:key:${ctx.keyId}`, `hc-webhook:user:${ctx.userId}`]) {
    if (!checkRateLimit(key, RATE_LIMIT)) {
      return json({ error: 'Rate limit exceeded' }, 429);
    }
  }

  // 5. Integration. The PAT resolves to exactly one user, and a user has at
  // most one integration — the client never supplies an integration id.
  const integration = findIntegrationRow(db, ctx.userId);
  if (!integration) {
    return json(
      { error: 'No Health Connect integration exists for this account. Create one in Settings.' },
      403,
    );
  }
  if (integration.status === 'paused' || integration.status === 'error') {
    return json({ error: `Integration is ${integration.status} and is not accepting data` }, 403);
  }

  // 6. Signature over the exact raw bytes, compared in constant time.
  const presented = request.headers.get(SIGNATURE_HEADER);
  if (presented) {
    let valid = false;
    try {
      valid = verifySignature(rawBody, integrationSecret(integration), presented);
    } catch (error) {
      safeError('health-connect webhook: signature verification failed', error);
      return json({ error: 'internal_error' }, 500);
    }
    if (!valid) return json({ error: 'Invalid X-Signature' }, 403);
  } else if (!allowsUnsigned()) {
    return json({ error: `Missing ${SIGNATURE_HEADER} header` }, 403);
  }

  // 7. Parse.
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Request body must be valid JSON' }, 400);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Request body must be a JSON object' }, 400);
  }

  const digest = bodyDigest(rawBody);

  // 8. Commit, then respond.
  let result: IngestResult;
  try {
    result = isTestPing(body)
      ? recordTestPing(ctx.userId, integration, body as Record<string, unknown>, digest)
      : ingestEnvelope({
          userId: ctx.userId,
          integration,
          body: body as Record<string, unknown>,
          bodySha256: digest,
        });
  } catch (error) {
    if (error instanceof EnvelopeError) {
      return json({ error: error.message }, 400);
    }
    // Never reflect internal error details to API clients (respond.ts policy).
    safeError('health-connect webhook: ingestion failed', error);
    return json({ error: 'internal_error' }, 500);
  }

  console.log(
    `health-connect ingest ${result.ingestId} status=${result.status} ` +
      `received=${result.counts.received} inserted=${result.counts.inserted} ` +
      `updated=${result.counts.updated} duplicates=${result.counts.duplicates} ` +
      `rejected=${result.counts.rejected} vitals=${result.normalization.vitals_upserted} ` +
      `nutrition_days=${result.normalization.nutrition_days_upserted}`,
  );

  return json({
    ingest_id: result.ingestId,
    status: result.status,
    records: result.counts,
    normalization: result.normalization,
  });
}
