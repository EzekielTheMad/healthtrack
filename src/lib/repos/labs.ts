/**
 * labs repository (lab_visits + lab_results).
 *
 * Authorization (003/012/014, encoded in src/lib/authz): owner full; shares
 * READ-ONLY with section 'labs' + exact dependent match. Delegates READ ONLY —
 * 012 granted delegates INSERT (no UPDATE/DELETE) on both tables, and our
 * Access model cannot split insert from update, so labs 'write' is
 * conservatively denied for delegates: labs mutations are owner-only.
 *
 * Storage note: lab_visits.source_pdf_path holds the relative filesystem
 * path (`<userId>/<uuid>.<ext>`) written by src/lib/storage and served by
 * GET /api/files/[...path].
 */
import { and, desc, eq, gte, inArray, like } from 'drizzle-orm';
import { z } from 'zod';
import { db, getSqlite } from '@/db';
import { randomUUID } from 'crypto';
import { isFullDate } from '@/lib/import/reconcile';
import { labResults, labVisits } from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { FitnessWriteError } from './_fitness';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type LabVisitRow = typeof labVisits.$inferSelect;
export type LabResultRow = typeof labResults.$inferSelect;

export interface LabVisitWithResults extends LabVisitRow {
  labResults: LabResultRow[];
}

export interface LabResultWithVisitDate extends LabResultRow {
  visitDate: string;
}

// Unknown keys (id, user_id, dependent_id, timestamps…) are stripped —
// row scope is never client-controlled.
const labResultInputSchema = z
  .object({
    panelName: z.string().nullish(),
    testName: z.string().trim().min(1),
    value: z.number().finite(),
    unit: z.string().nullish(),
    referenceRangeLow: z.number().finite().nullish(),
    referenceRangeHigh: z.number().finite().nullish(),
    referenceRangeText: z.string().nullish(),
    flag: z.enum(['normal', 'high', 'low', 'critical']).nullish(),
    loincCode: z.string().nullish(),
  })
  .strip();

const labVisitInputSchema = z
  .object({
    visitDate: z.string().refine(isFullDate, 'Enter an exact collection date (YYYY-MM-DD).'),
    providerId: z.string().nullish(),
    sourcePdfPath: z.string().nullish(),
    notes: z.string().nullish(),
    results: z.array(labResultInputSchema).default([]),
  })
  .strip();

export type LabVisitInput = z.input<typeof labVisitInputSchema>;

/**
 * Visits (newest first) with their results nested — hook parity with the old
 * PostgREST `lab_visits.select('*, lab_results(*)')` embed: results attach by
 * lab_visit_id, the dependent filter applies to the visit rows.
 */
export async function listLabVisitsWithResults(
  actorId: string,
  scope: ListScope
): Promise<LabVisitWithResults[]> {
  await requireListAuthz(actorId, scope, 'labs', 'read');
  const visits = await db
    .select()
    .from(labVisits)
    .where(
      and(
        eq(labVisits.userId, scope.ownerId),
        dependentFilter(labVisits.dependentId, scope.dependentId)
      )
    )
    .orderBy(desc(labVisits.visitDate));
  if (visits.length === 0) return [];

  const results = await db
    .select()
    .from(labResults)
    .where(
      inArray(
        labResults.labVisitId,
        visits.map((v) => v.id)
      )
    );
  const byVisit = new Map<string, LabResultRow[]>();
  for (const r of results) {
    const group = byVisit.get(r.labVisitId) ?? [];
    group.push(r);
    byVisit.set(r.labVisitId, group);
  }
  return visits.map((v) => ({ ...v, labResults: byVisit.get(v.id) ?? [] }));
}

/**
 * Create a visit plus its results (hook `saveLabVisit` parity: sequential
 * inserts, results inherit the visit's scope). Owner-only — see header.
 */
export async function createLabVisitWithResults(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown
): Promise<LabVisitWithResults> {
  await requireAuthz(actorId, scope, 'labs', 'write');
  const { results, ...visitValues } = labVisitInputSchema.parse(input);
  for (const result of results) {
    if (
      result.referenceRangeLow != null &&
      result.referenceRangeHigh != null &&
      result.referenceRangeLow > result.referenceRangeHigh
    )
      throw new FitnessWriteError('Reference range low must not exceed high.');
  }
  return db.transaction((tx) => {
    const [visit] = tx
      .insert(labVisits)
      .values({ ...visitValues, userId: scope.ownerId, dependentId: scope.dependentId })
      .returning()
      .all();

    let rows: LabResultRow[] = [];
    if (results.length > 0) {
      rows = tx
        .insert(labResults)
        .values(
          results.map((r) => ({
            ...r,
            userId: scope.ownerId,
            dependentId: scope.dependentId,
            labVisitId: visit.id,
          }))
        )
        .returning()
        .all();
    }
    return { ...visit, labResults: rows };
  });
}

const labVisitUpdateSchema = z
  .object({
    visitDate: z
      .string()
      .refine(isFullDate, 'Enter an exact collection date (YYYY-MM-DD).')
      .optional(),
    notes: z.string().max(10000).nullable().optional(),
    reason: z.string().max(2000).optional(),
    results: z
      .array(labResultInputSchema.partial().extend({ id: z.string().min(1) }))
      .max(2000)
      .optional(),
  })
  .strict();

/** Stable-ID corrections never replace results or the uploaded source file. */
export async function updateLabVisit(
  actorId: string,
  id: string,
  input: unknown
): Promise<LabVisitWithResults> {
  const visit = db.select().from(labVisits).where(eq(labVisits.id, id)).get();
  if (!visit) throw new NotFoundError();
  await requireAuthz(
    actorId,
    { ownerId: visit.userId, dependentId: visit.dependentId },
    'labs',
    'write'
  );
  const values = labVisitUpdateSchema.parse(input);
  const sqlite = getSqlite();
  return sqlite
    .transaction(() => {
      const currentVisit = db.select().from(labVisits).where(eq(labVisits.id, id)).get();
      if (!currentVisit) throw new NotFoundError();
      const before = {
        ...currentVisit,
        labResults: db.select().from(labResults).where(eq(labResults.labVisitId, id)).all(),
      };
      if (
        new Set((values.results ?? []).map((row) => row.id)).size !== (values.results ?? []).length
      )
        throw new FitnessWriteError('A result may only be corrected once per request.');
      for (const { id: resultId, ...patch } of values.results ?? []) {
        const previous = before.labResults.find((row) => row.id === resultId);
        if (!previous) throw new NotFoundError();
        const next = { ...previous, ...patch };
        if (
          next.referenceRangeLow !== null &&
          next.referenceRangeHigh !== null &&
          next.referenceRangeLow > next.referenceRangeHigh
        )
          throw new FitnessWriteError('Reference range low must not exceed high.');
        if (Object.keys(patch).length)
          db.update(labResults).set(patch).where(eq(labResults.id, resultId)).run();
      }
      const visitPatch = {
        ...(values.visitDate !== undefined ? { visitDate: values.visitDate } : {}),
        ...(values.notes !== undefined ? { notes: values.notes } : {}),
      };
      if (Object.keys(visitPatch).length)
        db.update(labVisits).set(visitPatch).where(eq(labVisits.id, id)).run();
      const after = {
        ...db.select().from(labVisits).where(eq(labVisits.id, id)).get()!,
        labResults: db.select().from(labResults).where(eq(labResults.labVisitId, id)).all(),
      };
      if (JSON.stringify(before) !== JSON.stringify(after))
        sqlite
          .prepare(
            'INSERT INTO clinical_corrections(id,user_id,dependent_id,domain,record_id,before_json,after_json,reason) VALUES(?,?,?,?,?,?,?,?)'
          )
          .run(
            randomUUID(),
            visit.userId,
            visit.dependentId,
            'lab_visits',
            id,
            JSON.stringify(before),
            JSON.stringify(after),
            values.reason ?? 'Manual correction'
          );
      return after;
    })
    .immediate();
}

export interface ListLabResultsOptions {
  /** Exact test-name filter (dashboard stat cards). */
  testNames?: string[];
}

/**
 * Flat results (newest created_at first) joined with their visit date —
 * serves the dashboard stat cards and the PDF export, which read the user's
 * results without a dependent filter ('all').
 */
export async function listLabResults(
  actorId: string,
  scope: ListScope,
  opts: ListLabResultsOptions = {}
): Promise<LabResultWithVisitDate[]> {
  await requireListAuthz(actorId, scope, 'labs', 'read');
  const rows = await db
    .select({ result: labResults, visitDate: labVisits.visitDate })
    .from(labResults)
    .innerJoin(labVisits, eq(labResults.labVisitId, labVisits.id))
    .where(
      and(
        eq(labResults.userId, scope.ownerId),
        dependentFilter(labResults.dependentId, scope.dependentId),
        opts.testNames && opts.testNames.length > 0
          ? inArray(labResults.testName, opts.testNames)
          : undefined
      )
    )
    .orderBy(desc(labResults.createdAt));
  return rows.map(({ result, visitDate }) => ({ ...result, visitDate }));
}

export interface ListLabResultsV1Options {
  /** Case-insensitive substring match on test_name (PAT `?test=`). */
  test?: string | null;
  /** Only results whose visit_date falls within the last N days. */
  days?: number | null;
}

/**
 * PAT surface (/api/v1/labs): the key owner's own data only (dependent_id
 * NULL), id desc — parity with the legacy PostgREST implementation.
 */
export async function listLabResultsV1(
  ownerId: string,
  opts: ListLabResultsV1Options
): Promise<LabResultWithVisitDate[]> {
  await requireAuthz(ownerId, { ownerId, dependentId: null }, 'labs', 'read');
  const conditions = [
    eq(labResults.userId, ownerId),
    dependentFilter(labResults.dependentId, null),
  ];
  if (opts.test) {
    // SQLite LIKE is case-insensitive for ASCII — matches PostgREST ilike
    conditions.push(like(labResults.testName, `%${opts.test}%`));
  }
  if (opts.days && opts.days > 0) {
    const since = new Date();
    since.setDate(since.getDate() - opts.days);
    conditions.push(gte(labVisits.visitDate, since.toISOString().split('T')[0]));
  }
  const rows = await db
    .select({ result: labResults, visitDate: labVisits.visitDate })
    .from(labResults)
    .innerJoin(labVisits, eq(labResults.labVisitId, labVisits.id))
    .where(and(...conditions))
    .orderBy(desc(labResults.id));
  return rows.map(({ result, visitDate }) => ({ ...result, visitDate }));
}
