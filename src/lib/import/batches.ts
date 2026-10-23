import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { getSqlite } from '@/db';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { FitnessConflictError, FitnessWriteError } from '@/lib/repos/_fitness';
import { invalidateInteractionCheck } from '@/lib/repos/interaction-alerts';
import {
  IMPORT_DOMAINS,
  isFullDate,
  reconcile,
  compatibleSpecimen,
  type Candidate,
  type Claim,
  type ImportDomain,
} from './reconcile';

export interface StagedClaim {
  domain: ImportDomain;
  payload: Claim;
}
interface BatchRow {
  id: string;
  user_id: string;
  dependent_id: string | null;
  file_hash: string;
  kind: string;
  file_name: string;
  source_path: string | null;
  status: string;
  warnings: string;
  created_at: string;
}
interface ItemRow {
  id: string;
  batch_id: string;
  position: number;
  domain: ImportDomain;
  payload: string;
  applied_payload: string | null;
  status: string;
  classification: string;
  record_id: string | null;
  action: string | null;
  error: string | null;
}
export interface ImportReviewItem extends Omit<ItemRow, 'payload'> {
  payload: Claim;
  matches: Candidate[];
}
export interface ImportBatchReview extends Omit<BatchRow, 'warnings'> {
  patient_name: string;
  warnings: string[];
  items: ImportReviewItem[];
  counts: Record<string, number>;
}

const text = z.string().max(10000).nullish();
const date = z
  .string()
  .refine(isFullDate, 'Enter an exact date (YYYY-MM-DD); partial or unknown dates stay in review.');
const optionalDate = date.nullish();
const name = z.string().trim().min(1).max(500);
const schemas = {
  medications: z.object({
    name,
    dosage: text,
    frequency: text,
    start_date: optionalDate,
    end_date: optionalDate,
    active: z.boolean().optional(),
    notes: text,
  }),
  conditions: z.object({
    name,
    status: z.enum(['active', 'resolved', 'managed', 'monitoring']).optional(),
    diagnosed_date: optionalDate,
    notes: text,
  }),
  allergies: z.object({
    name,
    severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']),
    reaction: text,
    diagnosed_date: optionalDate,
    notes: text,
  }),
  procedures: z.object({ name, procedure_date: date, notes: text }),
  vaccines: z.object({
    name,
    vaccine_date: date,
    dose_number: z.union([z.string(), z.number()]).nullish(),
    series_doses: z.union([z.string(), z.number()]).nullish(),
    manufacturer: text,
    lot_number: text,
    notes: text,
  }),
  lab_results: z.object({
    test_name: name,
    loinc_code: z.string().trim().max(100).nullish(),
    visit_date: date,
    panel_name: text,
    value: z.number().finite(),
    unit: text,
    reference_range_low: z.number().finite().nullish(),
    reference_range_high: z.number().finite().nullish(),
    reference_range_text: text,
    flag: z.enum(['normal', 'high', 'low', 'critical']).nullish(),
  }),
};
export const decisionSchema = z.object({
  item_id: z.string(),
  action: z.enum(['skip', 'add', 'link', 'correct']),
  target_id: z.string().optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().max(2000).optional(),
  // Review snapshot prevents applying a correction against a changed record.
  expected: z.record(z.string(), z.unknown()).optional(),
});
export type ImportDecision = z.infer<typeof decisionSchema>;
export const commitSchema = z.object({ decisions: z.array(decisionSchema).max(2000) });

export function fileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
async function authorize(userId: string, dependentId: string | null) {
  await requireAuthz(userId, { ownerId: userId, dependentId }, 'labs', 'write');
}
function loadBatch(userId: string, id: string): BatchRow {
  const row = getSqlite()
    .prepare('SELECT * FROM import_batches WHERE id=? AND user_id=?')
    .get(id, userId) as BatchRow | undefined;
  if (!row) throw new NotFoundError();
  return row;
}
function rawItems(batchId: string): ItemRow[] {
  return getSqlite()
    .prepare('SELECT * FROM import_items WHERE batch_id=? ORDER BY position')
    .all(batchId) as ItemRow[];
}

function candidates(userId: string, dependentId: string | null, domain: ImportDomain): Candidate[] {
  const sqlite = getSqlite();
  const rows =
    domain === 'lab_results'
      ? sqlite
          .prepare(
            'SELECT r.*, v.visit_date FROM lab_results r JOIN lab_visits v ON v.id=r.lab_visit_id WHERE r.user_id=? AND r.dependent_id IS ?'
          )
          .all(userId, dependentId)
      : sqlite
          .prepare(`SELECT * FROM ${domain} WHERE user_id=? AND dependent_id IS ?`)
          .all(userId, dependentId);
  return (rows as Claim[]).map((row) => {
    const values = { ...row };
    if (domain === 'medications') values.active = Boolean(values.active);
    // Prior import provenance supplies specimen identity absent from legacy tables.
    const evidence = sqlite
      .prepare(
        "SELECT i.payload FROM import_items i JOIN import_batches b ON b.id=i.batch_id WHERE b.user_id=? AND b.dependent_id IS ? AND i.domain=? AND i.record_id=? AND i.status IN ('applied','linked','corrected') ORDER BY i.created_at DESC,i.rowid DESC LIMIT 1"
      )
      .get(userId, dependentId, domain, row.id) as { payload: string } | undefined;
    if (evidence) {
      const original = JSON.parse(evidence.payload);
      for (const key of ['accession_id', 'specimen_id', 'collected_at'])
        if (original[key]) values[key] = original[key];
    }
    return { id: String(row.id), values };
  });
}

function review(batch: BatchRow): ImportBatchReview {
  const cache = new Map<ImportDomain, Candidate[]>();
  const staged = new Map<ImportDomain, Candidate[]>();
  const items = rawItems(batch.id).map((item) => {
    const payload = JSON.parse(item.payload) as Claim;
    let existing = cache.get(item.domain);
    if (!existing) {
      existing = candidates(batch.user_id, batch.dependent_id, item.domain);
      cache.set(item.domain, existing);
    }
    const result = reconcile(item.domain, payload, [
      ...existing,
      ...(staged.get(item.domain) ?? []),
    ]);
    const prior = staged.get(item.domain) ?? [];
    if (item.status === 'pending' || item.status === 'error')
      prior.push({ id: `staged:${item.id}`, values: payload });
    staged.set(item.domain, prior);
    return { ...item, payload, classification: result.classification, matches: result.matches };
  });
  const counts: Record<string, number> = {
    total: items.length,
    pending: 0,
    applied: 0,
    skipped: 0,
    linked: 0,
    corrected: 0,
    error: 0,
  };
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  const patient = batch.dependent_id
    ? (getSqlite()
        .prepare('SELECT name FROM dependents WHERE id=? AND parent_user_id=?')
        .get(batch.dependent_id, batch.user_id) as { name: string } | undefined)
    : undefined;
  return {
    ...batch,
    patient_name: patient?.name ?? 'Myself',
    warnings: JSON.parse(batch.warnings),
    items,
    counts,
  };
}

export async function getImportBatch(userId: string, id: string): Promise<ImportBatchReview> {
  const batch = loadBatch(userId, id);
  await authorize(userId, batch.dependent_id);
  return review(batch);
}
export async function listImportBatches(userId: string, dependentId: string | null) {
  await authorize(userId, dependentId);
  return getSqlite()
    .prepare(
      'SELECT id, kind, file_name, status, created_at FROM import_batches WHERE user_id=? AND dependent_id IS ? ORDER BY created_at DESC LIMIT 30'
    )
    .all(userId, dependentId);
}
export async function findImportBatch(
  userId: string,
  dependentId: string | null,
  hash: string,
  kind: string
) {
  await authorize(userId, dependentId);
  const row = getSqlite()
    .prepare(
      'SELECT * FROM import_batches WHERE user_id=? AND dependent_id IS ? AND file_hash=? AND kind=?'
    )
    .get(userId, dependentId, hash, kind) as BatchRow | undefined;
  return row ? review(row) : null;
}
export async function findImportBatchBySource(
  userId: string,
  dependentId: string | null,
  sourcePath: string
) {
  await authorize(userId, dependentId);
  return getSqlite()
    .prepare(
      'SELECT id FROM import_batches WHERE user_id=? AND dependent_id IS ? AND source_path=?'
    )
    .get(userId, dependentId, sourcePath) as { id: string } | undefined;
}
function hasExtractionFailure(warnings: string[]): boolean {
  return warnings.some((warning) =>
    /could not be processed|failed to extract|incomplete extraction/i.test(warning)
  );
}
function stableClaim(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableClaim).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableClaim(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function stageImportBatch(
  userId: string,
  dependentId: string | null,
  input: {
    hash: string;
    kind: 'labs' | 'medical_history';
    name: string;
    sourcePath?: string | null;
    warnings?: string[];
    items: StagedClaim[];
    retryExtraction?: boolean;
  }
): Promise<ImportBatchReview> {
  await authorize(userId, dependentId);
  if (input.items.length > 2000)
    throw new FitnessWriteError('A document may contain at most 2000 extracted items.');
  const sqlite = getSqlite();
  const id = sqlite
    .transaction(() => {
      const existing = sqlite
        .prepare(
          'SELECT id FROM import_batches WHERE user_id=? AND dependent_id IS ? AND file_hash=? AND kind=?'
        )
        .get(userId, dependentId, input.hash, input.kind) as { id: string } | undefined;
      if (existing) {
        if (input.retryExtraction) {
          const old = rawItems(existing.id);
          const keys = new Set(
            old.map((item) =>
              stableClaim({ domain: item.domain, payload: JSON.parse(item.payload) })
            )
          );
          const insert = sqlite.prepare(
            'INSERT INTO import_items(id,batch_id,position,domain,payload) VALUES(?,?,?,?,?)'
          );
          let position = old.length;
          for (const item of input.items) {
            const key = stableClaim(item);
            // This collapses only repeated extraction claims within the SAME
            // file+patient ledger, never name/date-based clinical records.
            if (!keys.has(key)) {
              insert.run(
                randomUUID(),
                existing.id,
                position++,
                item.domain,
                JSON.stringify(item.payload)
              );
              keys.add(key);
            }
          }
          if (position > 2000)
            throw new FitnessWriteError('A document may contain at most 2000 extracted items.');
          const pending = sqlite
            .prepare(
              "SELECT count(*) n FROM import_items WHERE batch_id=? AND status IN ('pending','error')"
            )
            .get(existing.id) as { n: number };
          const status = pending.n
            ? 'pending'
            : hasExtractionFailure(input.warnings ?? [])
              ? 'incomplete'
              : 'complete';
          sqlite
            .prepare('UPDATE import_batches SET warnings=?,status=?,updated_at=? WHERE id=?')
            .run(
              JSON.stringify(input.warnings ?? []),
              status,
              new Date().toISOString(),
              existing.id
            );
        }
        return existing.id;
      }
      const batchId = randomUUID();
      sqlite
        .prepare(
          'INSERT INTO import_batches(id,user_id,dependent_id,file_hash,kind,file_name,source_path,warnings) VALUES(?,?,?,?,?,?,?,?)'
        )
        .run(
          batchId,
          userId,
          dependentId,
          input.hash,
          input.kind,
          input.name.slice(0, 255),
          input.sourcePath ?? null,
          JSON.stringify(input.warnings ?? [])
        );
      const insert = sqlite.prepare(
        'INSERT INTO import_items(id,batch_id,position,domain,payload) VALUES(?,?,?,?,?)'
      );
      input.items.forEach((item, position) => {
        if (!IMPORT_DOMAINS.includes(item.domain))
          throw new FitnessWriteError('Unknown import domain.');
        insert.run(randomUUID(), batchId, position, item.domain, JSON.stringify(item.payload));
      });
      return batchId;
    })
    .immediate();
  return review(loadBatch(userId, id));
}

function persistClaim(
  batch: BatchRow,
  item: ItemRow,
  decision: ImportDecision,
  current: Candidate[]
): string {
  const sqlite = getSqlite();
  const original = JSON.parse(item.payload) as Claim;
  const target =
    (decision.action === 'link' || decision.action === 'correct') && decision.target_id
      ? current.find((row) => row.id === decision.target_id)
      : undefined;
  if ((decision.action === 'link' || decision.action === 'correct') && !target)
    throw new FitnessWriteError('Choose an existing record from this patient and domain.');
  if (decision.action === 'link') return target!.id;
  if (
    decision.action === 'correct' &&
    (!decision.expected || JSON.stringify(decision.expected) !== JSON.stringify(target!.values))
  )
    throw new FitnessConflictError(
      'This record changed after review. Reload it before correcting.'
    );
  // A correction changes only the fields explicitly reviewed; it never fills
  // absent extraction fields over existing clinical values.
  const source =
    decision.action === 'correct'
      ? {
          ...target!.values,
          ...(decision.values ??
            Object.fromEntries(Object.entries(original).filter(([, value]) => value !== null))),
        }
      : { ...original, ...(decision.values ?? {}) };
  const schema = schemas[item.domain];
  const values = schema.parse(source) as Claim;
  if (
    item.domain === 'lab_results' &&
    typeof original.raw_text === 'string' &&
    /[<>≤≥]|\b(less than|greater than|below|above)\b/i.test(original.raw_text)
  )
    throw new FitnessWriteError(
      'This printed result is a threshold, not an exact number. Keep it in review or skip it; numeric storage cannot represent the qualifier.'
    );
  if (
    item.domain === 'medications' &&
    typeof values.start_date === 'string' &&
    typeof values.end_date === 'string' &&
    values.end_date < values.start_date
  )
    throw new FitnessWriteError('Medication end date precedes its start date.');
  if (
    item.domain === 'lab_results' &&
    typeof values.reference_range_low === 'number' &&
    typeof values.reference_range_high === 'number' &&
    values.reference_range_low > values.reference_range_high
  )
    throw new FitnessWriteError('Reference range low must not exceed high.');
  delete values.visit_date;
  for (const key of Object.keys(values)) {
    if (values[key] === undefined) delete values[key];
    if (typeof values[key] === 'boolean') values[key] = values[key] ? 1 : 0;
    if ((key === 'dose_number' || key === 'series_doses') && values[key] !== null)
      values[key] = String(values[key]);
  }
  const recordId = target?.id ?? randomUUID();
  if (decision.action === 'correct') {
    // A result's collection date belongs to its visit; changing it through an
    // individual import correction would accidentally move its sibling tests.
    if (item.domain === 'lab_results' && source.visit_date !== target!.values.visit_date)
      throw new FitnessWriteError('Correct the collection date in the saved lab visit editor.');
    const keys = Object.keys(values);
    sqlite
      .prepare(`UPDATE ${item.domain} SET ${keys.map((key) => `${key}=?`).join(',')} WHERE id=?`)
      .run(...keys.map((key) => values[key] as string | number | null), recordId);
    const after = candidates(batch.user_id, batch.dependent_id, item.domain).find(
      (row) => row.id === recordId
    )!.values;
    sqlite
      .prepare(
        'INSERT INTO clinical_corrections(id,user_id,dependent_id,domain,record_id,batch_item_id,before_json,after_json,reason) VALUES(?,?,?,?,?,?,?,?,?)'
      )
      .run(
        randomUUID(),
        batch.user_id,
        batch.dependent_id,
        item.domain,
        recordId,
        item.id,
        JSON.stringify(target!.values),
        JSON.stringify(after),
        decision.reason ?? 'Document reconciliation'
      );
  } else {
    if (item.domain === 'lab_results') {
      // Keep the extraction's visit grouping without conflating separate draws.
      const prior = sqlite
        .prepare(
          "SELECT r.lab_visit_id, i.payload FROM import_items i JOIN lab_results r ON r.id=i.record_id WHERE i.batch_id=? AND i.status='applied' AND i.domain='lab_results'"
        )
        .all(batch.id) as { lab_visit_id: string; payload: string }[];
      const priorClaims = prior.map((row) => ({
        ...row,
        payload: JSON.parse(row.payload) as Claim,
      }));
      const sameVisit = priorClaims.find((row) => {
        const payload = row.payload;
        return (
          original._visit_key !== undefined &&
          payload._visit_key === original._visit_key &&
          payload.visit_date === source.visit_date &&
          priorClaims.every(
            (other) =>
              other.lab_visit_id !== row.lab_visit_id || compatibleSpecimen(other.payload, original)
          )
        );
      });
      const visitId = sameVisit?.lab_visit_id ?? randomUUID();
      if (!sameVisit)
        sqlite
          .prepare(
            'INSERT INTO lab_visits(id,user_id,dependent_id,visit_date,source_pdf_path,notes,created_at) VALUES(?,?,?,?,?,?,?)'
          )
          .run(
            visitId,
            batch.user_id,
            batch.dependent_id,
            source.visit_date as string,
            batch.source_path,
            `Imported from ${batch.file_name}`,
            new Date().toISOString()
          );
      values.lab_visit_id = visitId;
    }
    const now = new Date().toISOString();
    const insertValues = {
      id: recordId,
      user_id: batch.user_id,
      dependent_id: batch.dependent_id,
      created_at: now,
      ...(item.domain !== 'lab_results' ? { updated_at: now } : {}),
      ...values,
    };
    const keys = Object.keys(insertValues);
    sqlite
      .prepare(
        `INSERT INTO ${item.domain}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`
      )
      .run(...(Object.values(insertValues) as (string | number | null)[]));
  }
  if (item.domain === 'medications') {
    const after = sqlite
      .prepare('SELECT name,dosage,frequency,active,rxcui FROM medications WHERE id=?')
      .get(recordId) as Claim;
    const before = target?.values;
    const active = (value: unknown) => Boolean(value);
    const changed =
      !before ||
      ['name', 'dosage', 'frequency', 'active', 'rxcui'].some((key) =>
        key === 'active'
          ? active(before[key]) !== active(after[key])
          : (before[key] ?? null) !== (after[key] ?? null)
      );
    if (changed && (active(before?.active) || active(after.active)))
      invalidateInteractionCheck(batch.user_id, batch.dependent_id);
  }
  return recordId;
}

export async function commitImportBatch(
  userId: string,
  id: string,
  input: unknown
): Promise<ImportBatchReview> {
  const { decisions } = commitSchema.parse(input);
  if (new Set(decisions.map((decision) => decision.item_id)).size !== decisions.length)
    throw new FitnessWriteError('Each item may have only one decision.');
  const batch = loadBatch(userId, id);
  await authorize(userId, batch.dependent_id);
  const sqlite = getSqlite();
  sqlite
    .transaction(() => {
      const items = rawItems(id);
      for (const decision of decisions) {
        const item = items.find((row) => row.id === decision.item_id);
        if (!item) throw new NotFoundError();
        if (item.status !== 'pending' && item.status !== 'error') continue; // retries are durable no-ops
        try {
          sqlite.transaction(() => {
            const current = candidates(userId, batch.dependent_id, item.domain);
            const result = reconcile(
              item.domain,
              { ...JSON.parse(item.payload), ...(decision.values ?? {}) },
              current
            );
            let status = 'skipped';
            let recordId: string | null = null;
            if (decision.action !== 'skip') {
              if (decision.action === 'add' && result.classification === 'duplicate') {
                status = 'linked';
                recordId = result.matches[0].id;
              } else {
                recordId = persistClaim(batch, item, decision, current);
                status =
                  decision.action === 'add'
                    ? 'applied'
                    : decision.action === 'link'
                      ? 'linked'
                      : 'corrected';
              }
            }
            const applied = recordId
              ? candidates(userId, batch.dependent_id, item.domain).find(
                  (row) => row.id === recordId
                )?.values
              : null;
            sqlite
              .prepare(
                'UPDATE import_items SET status=?,classification=?,record_id=?,action=?,applied_payload=?,error=NULL WHERE id=?'
              )
              .run(
                status,
                result.classification,
                recordId,
                decision.action,
                applied ? JSON.stringify(applied) : null,
                item.id
              );
          })();
        } catch (error) {
          const message =
            error instanceof z.ZodError
              ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
              : error instanceof FitnessWriteError || error instanceof FitnessConflictError
                ? error.message
                : 'Could not apply this item. Review and retry.';
          sqlite
            .prepare("UPDATE import_items SET status='error',action=?,error=? WHERE id=?")
            .run(decision.action, message, item.id);
        }
      }
      const remaining = sqlite
        .prepare(
          "SELECT count(*) AS n FROM import_items WHERE batch_id=? AND status IN ('pending','error')"
        )
        .get(id) as { n: number };
      const warnings = JSON.parse(loadBatch(userId, id).warnings) as string[];
      sqlite
        .prepare('UPDATE import_batches SET status=?,updated_at=? WHERE id=?')
        .run(
          remaining.n ? 'pending' : hasExtractionFailure(warnings) ? 'incomplete' : 'complete',
          new Date().toISOString(),
          id
        );
    })
    .immediate();
  return review(loadBatch(userId, id));
}
