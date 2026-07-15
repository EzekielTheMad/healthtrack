/**
 * POST /api/import-medical-history — persist user-approved items from a
 * medical-history extraction into the chosen profile (self or dependent).
 *
 * The client sends only the items the user checked, but its checkboxes are
 * advisory: dedupe is re-run server-side against the target scope's current
 * rows and exact duplicates are SKIPPED. 'possible' matches the user approved
 * are imported. Loading the existing rows also verifies the dependent belongs
 * to the caller (authz → 404) before anything is created.
 *
 * No AI involved → no rate limit; session auth required. Returns per-domain
 * { created, skipped_duplicates, errors } counts (items are counted
 * individually — lab counts are per result, not per visit).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { safeError } from '@/lib/safe-log';
import { createMedication, listMedications } from '@/lib/repos/medications';
import { createCondition, listConditions } from '@/lib/repos/conditions';
import { createAllergy, listAllergies } from '@/lib/repos/allergies';
import { createProcedure, listProcedures } from '@/lib/repos/procedures';
import { createVaccine, listVaccines } from '@/lib/repos/vaccines';
import { createLabVisitWithResults, listLabResults } from '@/lib/repos/labs';
import {
  addNameDate,
  buildLabResultIndex,
  buildNameDateIndex,
  buildNameIndex,
  dedupeByName,
  dedupeByNameDate,
  dedupeLabResult,
  labResultKey,
  normalizeName,
  type NameDateIndex,
} from '@/lib/import/dedupe';

// Wire format matches the parse route's review items (snake_case). Unknown
// keys — including the advisory dedupe_status annotations — are stripped.
const nullableString = z.string().nullish();

const medicationItemSchema = z.object({
  name: z.string().trim().min(1),
  dosage: nullableString,
  frequency: nullableString,
  start_date: nullableString,
  end_date: nullableString,
  active: z.boolean().nullish(),
  notes: nullableString,
});

const conditionItemSchema = z.object({
  name: z.string().trim().min(1),
  status: z.enum(['active', 'resolved', 'managed', 'monitoring']).nullish(),
  diagnosed_date: nullableString,
  notes: nullableString,
});

const allergyItemSchema = z.object({
  name: z.string().trim().min(1),
  severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']).nullish(),
  reaction: nullableString,
  diagnosed_date: nullableString,
  notes: nullableString,
});

const procedureItemSchema = z.object({
  name: z.string().trim().min(1),
  procedure_date: nullableString,
  notes: nullableString,
});

const vaccineItemSchema = z.object({
  name: z.string().trim().min(1),
  vaccine_date: nullableString,
  dose_number: z.number().nullish(),
  series_doses: z.number().nullish(),
  manufacturer: nullableString,
  lot_number: nullableString,
  notes: nullableString,
});

const labResultItemSchema = z.object({
  test_name: z.string().trim().min(1),
  value: z.number(),
  unit: nullableString,
  reference_range_text: nullableString,
  flag: z.enum(['normal', 'high', 'low', 'critical']).nullish(),
});

const labVisitItemSchema = z.object({
  visit_date: z.string().trim().min(1),
  results: z.array(labResultItemSchema).default([]),
});

const bodySchema = z.object({
  dependent_id: z.string().nullish(),
  medications: z.array(medicationItemSchema).default([]),
  conditions: z.array(conditionItemSchema).default([]),
  allergies: z.array(allergyItemSchema).default([]),
  procedures: z.array(procedureItemSchema).default([]),
  vaccines: z.array(vaccineItemSchema).default([]),
  lab_visits: z.array(labVisitItemSchema).default([]),
});

export interface ImportDomainCounts {
  created: number;
  skipped_duplicates: number;
  errors: number;
}

export interface ImportMedicalHistoryResult {
  medications: ImportDomainCounts;
  conditions: ImportDomainCounts;
  allergies: ImportDomainCounts;
  procedures: ImportDomainCounts;
  vaccines: ImportDomainCounts;
  lab_results: ImportDomainCounts;
}

function emptyCounts(): ImportDomainCounts {
  return { created: 0, skipped_duplicates: 0, errors: 0 };
}

/** Create items in a name-deduped domain (medications/conditions/allergies). */
async function importNamedItems<Item extends { name: string }>(
  items: Item[],
  index: Set<string>,
  create: (item: Item) => Promise<unknown>,
): Promise<ImportDomainCounts> {
  const counts = emptyCounts();
  for (const item of items) {
    if (dedupeByName(item.name, index) === 'duplicate') {
      counts.skipped_duplicates += 1;
      continue;
    }
    try {
      await create(item);
      index.add(normalizeName(item.name));
      counts.created += 1;
    } catch (err) {
      safeError('Medical history import item failed', err);
      counts.errors += 1;
    }
  }
  return counts;
}

/** Create items in a name+date-deduped domain (procedures/vaccines). */
async function importDatedItems<Item extends { name: string }>(
  items: Item[],
  index: NameDateIndex,
  dateOf: (item: Item) => string | null | undefined,
  create: (item: Item) => Promise<unknown>,
): Promise<ImportDomainCounts> {
  const counts = emptyCounts();
  for (const item of items) {
    if (dedupeByNameDate(item.name, dateOf(item), index) === 'duplicate') {
      counts.skipped_duplicates += 1;
      continue;
    }
    try {
      await create(item);
      addNameDate(index, item.name, dateOf(item));
      counts.created += 1;
    } catch (err) {
      safeError('Medical history import item failed', err);
      counts.errors += 1;
    }
  }
  return counts;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await request.json());

    const dependentId = body.dependent_id || null;
    const scope = { ownerId: user.id, dependentId };

    // Load current rows for the authoritative dedupe re-check. The first authz
    // check also verifies the dependent belongs to the caller (404 otherwise)
    // before any row is created.
    const [medications, conditions, allergies, procedures, vaccines, labResults] =
      await Promise.all([
        listMedications(user.id, scope),
        listConditions(user.id, scope),
        listAllergies(user.id, scope),
        listProcedures(user.id, scope),
        listVaccines(user.id, scope),
        listLabResults(user.id, scope),
      ]);

    const medicationIndex = buildNameIndex(medications.map((m) => m.name));
    const conditionIndex = buildNameIndex(conditions.map((c) => c.name));
    const allergyIndex = buildNameIndex(allergies.map((a) => a.name));
    const procedureIndex = buildNameDateIndex(
      procedures.map((p) => ({ name: p.name, date: p.procedureDate })),
    );
    const vaccineIndex = buildNameDateIndex(
      vaccines.map((v) => ({ name: v.name, date: v.vaccineDate })),
    );
    const labIndex = buildLabResultIndex(
      labResults.map((r) => ({ visitDate: r.visitDate, testName: r.testName })),
    );

    const result: ImportMedicalHistoryResult = {
      medications: await importNamedItems(body.medications, medicationIndex, (m) =>
        createMedication(user.id, scope, {
          name: m.name,
          dosage: m.dosage ?? null,
          frequency: m.frequency ?? null,
          startDate: m.start_date ?? null,
          endDate: m.end_date ?? null,
          ...(typeof m.active === 'boolean' ? { active: m.active } : {}),
          notes: m.notes ?? null,
        }),
      ),
      conditions: await importNamedItems(body.conditions, conditionIndex, (c) =>
        createCondition(user.id, scope, {
          name: c.name,
          ...(c.status ? { status: c.status } : {}),
          diagnosedDate: c.diagnosed_date ?? null,
          notes: c.notes ?? null,
        }),
      ),
      allergies: await importNamedItems(body.allergies, allergyIndex, (a) =>
        createAllergy(user.id, scope, {
          name: a.name,
          // The allergies table requires a severity; documents often omit it.
          // Default conservatively to 'mild' — the user can edit afterwards.
          severity: a.severity ?? 'mild',
          reaction: a.reaction ?? null,
          diagnosedDate: a.diagnosed_date ?? null,
          notes: a.notes ?? null,
        }),
      ),
      procedures: await importDatedItems(
        body.procedures,
        procedureIndex,
        (p) => p.procedure_date,
        (p) =>
          createProcedure(user.id, scope, {
            name: p.name,
            // Required column — items without a date fail per-item validation
            // and are reported in the errors count.
            procedureDate: p.procedure_date ?? '',
            notes: p.notes ?? null,
          }),
      ),
      vaccines: await importDatedItems(
        body.vaccines,
        vaccineIndex,
        (v) => v.vaccine_date,
        (v) =>
          createVaccine(user.id, scope, {
            name: v.name,
            vaccineDate: v.vaccine_date ?? '',
            doseNumber: v.dose_number ?? null,
            seriesDoses: v.series_doses ?? null,
            manufacturer: v.manufacturer ?? null,
            lotNumber: v.lot_number ?? null,
            notes: v.notes ?? null,
          }),
      ),
      lab_results: emptyCounts(),
    };

    // Labs: one visit row per extracted visit, containing only the results
    // that are not already on record for that date.
    for (const visit of body.lab_visits) {
      const fresh = visit.results.filter(
        (r) => dedupeLabResult(visit.visit_date, r.test_name, labIndex) !== 'duplicate',
      );
      result.lab_results.skipped_duplicates += visit.results.length - fresh.length;
      if (fresh.length === 0) continue;
      try {
        await createLabVisitWithResults(user.id, scope, {
          visitDate: visit.visit_date,
          results: fresh.map((r) => ({
            testName: r.test_name,
            value: r.value,
            unit: r.unit ?? null,
            referenceRangeText: r.reference_range_text ?? null,
            flag: r.flag ?? null,
          })),
        });
        for (const r of fresh) {
          labIndex.add(labResultKey(visit.visit_date, r.test_name));
        }
        result.lab_results.created += fresh.length;
      } catch (err) {
        safeError('Medical history lab visit import failed', err);
        result.lab_results.errors += fresh.length;
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
