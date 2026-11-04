/** Compatibility entry point: every path now passes through the durable ledger. */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { fileHash, commitImportBatch, stageImportBatch } from '@/lib/import/batches';
import { historyClaims } from '@/lib/import/claims';
import type { ParsedMedicalHistory } from '@/lib/claude/parse-medical-history';
import { z } from 'zod';

export interface ImportDomainCounts {
  created: number;
  skipped_duplicates: number;
  errors: number;
  linked?: number;
  corrected?: number;
  pending?: number;
}
export interface ImportMedicalHistoryResult {
  medications: ImportDomainCounts;
  conditions: ImportDomainCounts;
  allergies: ImportDomainCounts;
  procedures: ImportDomainCounts;
  vaccines: ImportDomainCounts;
  lab_results: ImportDomainCounts;
  batch_id?: string;
}
const bodySchema = z.object({
  dependent_id: z.string().nullish(),
  batch_id: z.string().optional(),
  decisions: z.array(z.unknown()).optional(),
  medications: z.array(z.record(z.string(), z.unknown())).default([]),
  conditions: z.array(z.record(z.string(), z.unknown())).default([]),
  allergies: z.array(z.record(z.string(), z.unknown())).default([]),
  procedures: z.array(z.record(z.string(), z.unknown())).default([]),
  vaccines: z.array(z.record(z.string(), z.unknown())).default([]),
  lab_visits: z
    .array(
      z.object({
        visit_date: z.string().nullish(),
        results: z.array(z.record(z.string(), z.unknown())),
      })
    )
    .default([]),
});
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await request.json());
    let id = body.batch_id;
    let decisions = body.decisions;
    if (!id) {
      // Legacy clients have already reviewed these claims. The exact payload is
      // their idempotency key; ambiguous records are retained, never name-dropped.
      const batch = await stageImportBatch(user.id, body.dependent_id || null, {
        hash: fileHash(Buffer.from(JSON.stringify(body))),
        kind: 'medical_history',
        name: 'Reviewed medical history',
        items: historyClaims(body as unknown as ParsedMedicalHistory),
      });
      id = batch.id;
      decisions = batch.items.map((item) => ({ item_id: item.id, action: 'add' }));
    }
    const batch = await commitImportBatch(user.id, id, { decisions: decisions ?? [] });
    const counts = Object.fromEntries(
      ['medications', 'conditions', 'allergies', 'procedures', 'vaccines', 'lab_results'].map(
        (domain) => {
          const items = batch.items.filter((item) => item.domain === domain);
          return [
            domain,
            {
              created: items.filter((item) => item.status === 'applied').length,
              skipped_duplicates: items.filter((item) => item.status === 'linked').length,
              errors: items.filter((item) => item.status === 'error').length,
              linked: items.filter((item) => item.status === 'linked').length,
              corrected: items.filter((item) => item.status === 'corrected').length,
              pending: items.filter((item) => item.status === 'pending').length,
            },
          ];
        }
      )
    );
    return NextResponse.json({ ...counts, batch_id: batch.id });
  } catch (error) {
    return errorResponse(error);
  }
}
