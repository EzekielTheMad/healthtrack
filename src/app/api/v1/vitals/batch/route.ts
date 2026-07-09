import { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { db } from '@/db';
import { bodyToCamel } from '@/lib/api/snake';
import {
  upsertOwnVital,
  validateVitalWrite,
  type ValidatedVitalWrite,
} from '@/lib/repos/vitals';

const MAX_RECORDS = 500;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

const envelopeSchema = z.object({
  records: z.array(z.unknown()).max(MAX_RECORDS),
});

/**
 * POST /api/v1/vitals/batch — bulk registry-validated upsert (max 500
 * records), self-scope only. Per-record validation errors are reported by
 * index and do not abort the batch; all valid records are written in ONE
 * better-sqlite3 transaction. 400 is reserved for a malformed envelope.
 *
 * Body: { records: [{ metric_key, value?, value_label?, unit?, recorded_at, source, metadata? }] }
 * 200:  { inserted: n, updated: n, errors: [{ index, message }] }
 */
export async function POST(request: NextRequest) {
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, 'write:vitals')) return forbidden('write:vitals');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Request body must be valid JSON' },
      { status: 400, headers: corsHeaders },
    );
  }

  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) {
    return Response.json(
      { error: `Body must be { records: [...] } with at most ${MAX_RECORDS} records` },
      { status: 400, headers: corsHeaders },
    );
  }

  const errors: { index: number; message: string }[] = [];
  const valid: ValidatedVitalWrite[] = [];
  envelope.data.records.forEach((record, index) => {
    try {
      valid.push(validateVitalWrite(bodyToCamel(record)));
    } catch (error) {
      errors.push({
        index,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  let inserted = 0;
  let updated = 0;
  try {
    db.transaction((tx) => {
      for (const record of valid) {
        if (upsertOwnVital(tx, ctx.userId, record) === 'inserted') inserted += 1;
        else updated += 1;
      }
    });
  } catch (error) {
    // Never reflect internal error details to API clients (respond.ts policy).
    console.error('v1 vitals batch error:', error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }

  return Response.json({ inserted, updated, errors }, { headers: corsHeaders });
}
