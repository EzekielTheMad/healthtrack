/** Typed clinical facts and durable owner-approved intake. No canonical PAT writes. */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSqlite } from '@/db';
import { authorize, NotFoundError, requireAuthz, type AuthzScope } from '@/lib/authz';
import { requireListAuthz, type ListScope } from '@/lib/repos/_scope';
import { FitnessConflictError, FitnessWriteError } from '@/lib/repos/_fitness';
import { invalidateInteractionCheck } from '@/lib/repos/interaction-alerts';
import {
  clinicalFactSchema,
  intakeSchema,
  unknownClinicalDate,
  type ClinicalFact,
  type ClinicalIntake,
  type FidelityRecord,
} from './contracts';
import { approvalDigest, canonicalJson, contentRevision } from './security';
import { CLINICAL_KIND_SECTIONS } from './web-clinical-contracts';

type Kind = ClinicalFact['kind'];
type IntakeItem = ClinicalIntake['items'][number];
type SqlRecord = {
  id: string;
  user_id: string;
  dependent_id: string | null;
  kind: Kind;
  payload_json: string;
  revision: number;
  source_key: string | null;
  legacy_table: LegacyTable | null;
  legacy_id: string | null;
  legacy_revision: string | null;
  received_at: string;
  updated_at: string;
};
type Batch = {
  id: string;
  user_id: string;
  dependent_id: string | null;
  external_id: string;
  version: number;
  payload_json: string;
  digest: string;
  received_at: string;
  updated_at: string;
  approved_at: string | null;
  approved_digest: string | null;
};
export type ClinicalOutcome = {
  item_key: string;
  status: 'created' | 'corrected' | 'linked' | 'skipped' | 'unresolved';
  record_id: string | null;
  reason: string;
};
export type ClinicalMatch = {
  id: string;
  revision: string;
  fact: ClinicalFact;
  legacy: boolean;
  legacy_conflict?: boolean;
  current_legacy?: ClinicalFact;
  classification: 'duplicate' | 'possible' | 'conflict';
};
export type ClinicalReviewItem = IntakeItem & {
  matches: ClinicalMatch[];
  matching_count: number;
  matching_revision: string;
  outcome: ClinicalOutcome | null;
};
export type ClinicalReview = {
  id: string;
  user_id: string;
  dependent_id: string | null;
  external_id: string;
  version: number;
  digest: string;
  approved_at: string | null;
  received_at: string;
  items: ClinicalReviewItem[];
  counts: Record<string, number>;
  coverage: string[];
  documents: { id: string; file_name: string; held: number; pending: number; status: string }[];
};

const MAX_ROWS = 1000;
type LegacyTable = 'lab_results' | 'medications' | 'conditions' | 'procedures';
const legacyTables = {
  lab: 'lab_results',
  medication: 'medications',
  condition: 'conditions',
  procedure: 'procedures',
} as const;
const legacyKinds = {
  lab_results: 'lab',
  medications: 'medication',
  conditions: 'condition',
  procedures: 'procedure',
} as const;
const legacyTable = (kind: Kind): LegacyTable | undefined =>
  legacyTables[kind as keyof typeof legacyTables];
const section = (kind: Kind) => CLINICAL_KIND_SECTIONS[kind];
const normalizedName = (s: string) => s.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const provenance = {
  basis: 'legacy_unknown' as const,
  verification: 'unconfirmed' as const,
  sources: [],
};

function scopedWhere(scope: ListScope, alias = ''): { sql: string; args: string[] } {
  const prefix = alias ? alias + '.' : '';
  return {
    sql: `${prefix}user_id=?${scope.dependentId === 'all' ? '' : ` AND ${prefix}dependent_id IS ?`}`,
    args:
      scope.dependentId === 'all'
        ? [scope.ownerId]
        : ([scope.ownerId, scope.dependentId] as string[]),
  };
}
function typedRow(row: SqlRecord): FidelityRecord {
  const base =
    row.legacy_table && row.legacy_id
      ? legacyRecord(
          { ownerId: row.user_id, dependentId: row.dependent_id },
          row.legacy_table,
          row.legacy_id
        )
      : null;
  const overlay =
    row.legacy_table && row.legacy_id && row.legacy_revision
      ? {
          supersedes_legacy: {
            table: row.legacy_table,
            id: row.legacy_id,
            revision: row.legacy_revision,
          },
          legacy_conflict: base?.revision !== row.legacy_revision,
        }
      : {};
  return {
    id: row.id,
    user_id: row.user_id,
    dependent_id: row.dependent_id,
    kind: row.kind,
    fact: clinicalFactSchema.parse(JSON.parse(row.payload_json)),
    revision: contentRevision({
      payload: JSON.parse(row.payload_json),
      revision: row.revision,
      ...(row.legacy_id ? { legacy_current_revision: base?.revision ?? null } : {}),
    }),
    received_at: row.received_at,
    updated_at: row.updated_at,
    legacy: false,
    ...overlay,
  };
}
function legacyMed(row: Record<string, unknown>): FidelityRecord {
  const fact = clinicalFactSchema.parse({
    kind: 'medication',
    name: row.name,
    supplement: row.category === 'supplement',
    status: 'unconfirmed',
    prescribed_directions: row.frequency || undefined,
    start_date: unknownClinicalDate(row.start_date as string | null),
    end_date: unknownClinicalDate(row.end_date as string | null),
    rxcui: row.rxcui,
    notes: row.notes,
    provenance: {
      ...provenance,
      notes: `Legacy active flag: ${Boolean(row.active)}; legacy dosage text: ${row.dosage ?? 'not reported'}. Prescribed versus actual use is unknown.`,
    },
  });
  return {
    id: `legacy:medication:${row.id}`,
    user_id: row.user_id as string,
    dependent_id: row.dependent_id as string | null,
    kind: 'medication',
    fact,
    revision: contentRevision(row),
    received_at: null,
    updated_at: row.updated_at as string,
    legacy: true,
  };
}
function legacyLab(row: Record<string, unknown>): FidelityRecord {
  const fact = clinicalFactSchema.parse({
    kind: 'lab',
    test_name: row.test_name,
    panel_name: row.panel_name,
    outcome: { kind: 'numeric', value: row.value, comparator: '=' },
    source_unit: row.unit,
    raw_result: String(row.value),
    reference: {
      low: row.reference_range_low,
      high: row.reference_range_high,
      text: row.reference_range_text,
    },
    printed_flags: [],
    derived_flag: 'unknown',
    collection_date: unknownClinicalDate(row.visit_date as string),
    loinc_code: row.loinc_code,
    provenance: {
      ...provenance,
      notes: row.flag ? `Legacy flag (${row.flag}) has unknown printed/derived origin.` : undefined,
    },
  });
  return {
    id: `legacy:lab:${row.id}`,
    user_id: row.user_id as string,
    dependent_id: row.dependent_id as string | null,
    kind: 'lab',
    fact,
    revision: contentRevision(row),
    received_at: null,
    updated_at: row.created_at as string,
    legacy: true,
  };
}
/** Legacy dates/statuses are source evidence, not proof of a confirmed diagnosis or completed procedure. */
function legacyClinical(
  row: Record<string, unknown>,
  kind: 'condition' | 'procedure'
): FidelityRecord {
  const fact = clinicalFactSchema.parse({
    kind,
    name: row.name,
    notes: row.notes,
    ...(kind === 'condition'
      ? {
          certainty: 'unknown',
          activity: row.status === 'active' || row.status === 'resolved' ? row.status : 'unknown',
          temporal_scope: 'unknown',
          diagnosis_date: unknownClinicalDate(row.diagnosed_date as string | null),
          codes: row.icd10_code ? [{ system: 'ICD-10', code: row.icd10_code }] : [],
        }
      : {
          status: 'unknown',
          procedure_date: unknownClinicalDate(row.procedure_date as string | null),
          codes: row.cpt_code ? [{ system: 'CPT', code: row.cpt_code }] : [],
        }),
    provenance: {
      ...provenance,
      notes:
        kind === 'condition'
          ? `Legacy status: ${row.status ?? 'not reported'}; certainty and temporal scope were not recorded.`
          : 'Legacy procedure date retained as source text. Completion was not recorded.',
    },
  });
  return {
    id: `legacy:${kind}:${row.id}`,
    user_id: row.user_id as string,
    dependent_id: row.dependent_id as string | null,
    kind,
    fact,
    revision: contentRevision(row),
    received_at: null,
    updated_at: row.updated_at as string,
    legacy: true,
  };
}
function recordsInScope(
  scope: ListScope,
  kinds: Kind[],
  limit = MAX_ROWS,
  test?: string | null
): FidelityRecord[] {
  const sqlite = getSqlite();
  const where = scopedWhere(scope);
  const rows = sqlite
    .prepare(
      `SELECT * FROM clinical_records WHERE ${where.sql} AND kind IN (${kinds.map(() => '?').join(',')})${test ? " AND json_extract(payload_json,'$.test_name') LIKE ?" : ''} ORDER BY received_at DESC,id LIMIT ?`
    )
    .all(...where.args, ...kinds, ...(test ? ['%' + test + '%'] : []), limit) as SqlRecord[];
  const records = rows.map(typedRow);
  if (kinds.includes('medication'))
    records.push(
      ...(
        sqlite
          .prepare(
            `SELECT * FROM medications WHERE ${where.sql} ORDER BY created_at DESC,id LIMIT ?`
          )
          .all(...where.args, limit) as Record<string, unknown>[]
      ).map(legacyMed)
    );
  if (kinds.includes('lab')) {
    const labWhere = scopedWhere(scope, 'r');
    records.push(
      ...(
        sqlite
          .prepare(
            `SELECT r.*,v.visit_date,v.source_pdf_path FROM lab_results r JOIN lab_visits v ON v.id=r.lab_visit_id AND v.user_id=r.user_id AND v.dependent_id IS r.dependent_id WHERE ${labWhere.sql}${test ? ' AND r.test_name LIKE ?' : ''} ORDER BY r.created_at DESC,r.id LIMIT ?`
          )
          .all(...labWhere.args, ...(test ? ['%' + test + '%'] : []), limit) as Record<
          string,
          unknown
        >[]
      ).map(legacyLab)
    );
  }
  for (const kind of ['condition', 'procedure'] as const) {
    if (!kinds.includes(kind)) continue;
    const table = legacyTables[kind];
    records.push(
      ...(
        sqlite
          .prepare(`SELECT * FROM ${table} WHERE ${where.sql} ORDER BY created_at DESC,id LIMIT ?`)
          .all(...where.args, limit) as Record<string, unknown>[]
      ).map((row) => legacyClinical(row, kind))
    );
  }
  // Filtering or a bounded read can exclude an overlay. Its preserved original
  // must still never reappear as an unqualified current result.
  const current = records.filter((record) => {
    if (!record.legacy) return true;
    const overlay = sqlite
      .prepare(
        'SELECT * FROM clinical_records WHERE user_id=? AND dependent_id IS ? AND legacy_table=? AND legacy_id=?'
      )
      .get(
        record.user_id,
        record.dependent_id,
        legacyTable(record.kind),
        record.id.slice(`legacy:${record.kind}:`.length)
      ) as SqlRecord | undefined;
    if (!overlay) return true;
    if (!typedRow(overlay).legacy_conflict) return false;
    record.legacy_conflict = true;
    return true;
  });
  const conflicted = new Set(
    records
      .filter((record) => record.supersedes_legacy && record.legacy_conflict)
      .map(
        (record) =>
          `legacy:${legacyKinds[record.supersedes_legacy!.table]}:${record.supersedes_legacy!.id}`
      )
  );
  for (const record of records)
    if (record.legacy && conflicted.has(record.id)) record.legacy_conflict = true;
  const hidden = new Set(
    records
      .filter((r) => r.supersedes_legacy && !r.legacy_conflict)
      .map((r) => `legacy:${legacyKinds[r.supersedes_legacy!.table]}:${r.supersedes_legacy!.id}`)
  );
  return current
    .filter((r) => !hidden.has(r.id))
    .sort(
      (a, b) => (b.received_at ?? '').localeCompare(a.received_at ?? '') || a.id.localeCompare(b.id)
    )
    .slice(0, limit);
}
/** Authorized, bounded typed read. Legacy certainty is deliberately not backfilled. */
export async function listClinicalFacts(
  actorId: string,
  scope: ListScope,
  options: { limit?: number; kind?: Kind; test?: string | null } = {}
): Promise<FidelityRecord[]> {
  const kinds = options.kind ? [options.kind] : (Object.keys(CLINICAL_KIND_SECTIONS) as Kind[]);
  const allowed: Kind[] = [];
  for (const kind of kinds) {
    try {
      await requireListAuthz(actorId, scope, section(kind), 'read');
      allowed.push(kind);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  if (!allowed.length) throw new NotFoundError();
  const limit = Math.min(MAX_ROWS, Math.max(1, Math.trunc(options.limit ?? 200)));
  if (options.test && options.kind !== 'lab')
    throw new FitnessWriteError('The test filter requires kind=lab.');
  return recordsInScope(scope, allowed, limit, options.test);
}
function legacyRecord(scope: AuthzScope, table: LegacyTable, id: string): FidelityRecord | null {
  const sqlite = getSqlite();
  if (table === 'conditions' || table === 'procedures') {
    const row = sqlite
      .prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=? AND dependent_id IS ?`)
      .get(id, scope.ownerId, scope.dependentId) as Record<string, unknown> | undefined;
    return row ? legacyClinical(row, legacyKinds[table]) : null;
  }
  if (table === 'medications') {
    const row = sqlite
      .prepare('SELECT * FROM medications WHERE id=? AND user_id=? AND dependent_id IS ?')
      .get(id, scope.ownerId, scope.dependentId) as Record<string, unknown> | undefined;
    return row ? legacyMed(row) : null;
  }
  const row = sqlite
    .prepare(
      'SELECT r.*,v.visit_date,v.source_pdf_path FROM lab_results r JOIN lab_visits v ON v.id=r.lab_visit_id AND v.user_id=r.user_id AND v.dependent_id IS r.dependent_id WHERE r.id=? AND r.user_id=? AND r.dependent_id IS ?'
    )
    .get(id, scope.ownerId, scope.dependentId) as Record<string, unknown> | undefined;
  return row ? legacyLab(row) : null;
}
function recordInScope(scope: AuthzScope, id: string): FidelityRecord | null {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare('SELECT * FROM clinical_records WHERE id=? AND user_id=? AND dependent_id IS ?')
    .get(id, scope.ownerId, scope.dependentId) as SqlRecord | undefined;
  if (row) return typedRow(row);
  for (const kind of ['condition', 'procedure'] as const) {
    const prefix = `legacy:${kind}:`;
    if (id.startsWith(prefix))
      return legacyRecord(scope, legacyTables[kind], id.slice(prefix.length));
  }
  if (id.startsWith('legacy:medication:')) {
    const med = sqlite
      .prepare('SELECT * FROM medications WHERE id=? AND user_id=? AND dependent_id IS ?')
      .get(id.slice('legacy:medication:'.length), scope.ownerId, scope.dependentId) as
      | Record<string, unknown>
      | undefined;
    return med ? legacyMed(med) : null;
  }
  if (id.startsWith('legacy:lab:')) {
    const lab = sqlite
      .prepare(
        'SELECT r.*,v.visit_date,v.source_pdf_path FROM lab_results r JOIN lab_visits v ON v.id=r.lab_visit_id AND v.user_id=r.user_id AND v.dependent_id IS r.dependent_id WHERE r.id=? AND r.user_id=? AND r.dependent_id IS ?'
      )
      .get(id.slice('legacy:lab:'.length), scope.ownerId, scope.dependentId) as
      | Record<string, unknown>
      | undefined;
    return lab ? legacyLab(lab) : null;
  }
  return null;
}
export async function getClinicalFact(
  actorId: string,
  scope: AuthzScope,
  id: string
): Promise<FidelityRecord> {
  const record = recordInScope(scope, id);
  if (!record) throw new NotFoundError();
  await requireAuthz(actorId, scope, section(record.kind), 'read');
  return record;
}
async function requireOwner(actorId: string, scope: AuthzScope) {
  if (!actorId || actorId !== scope.ownerId) throw new NotFoundError();
  await requireAuthz(actorId, scope, 'labs', 'write');
}
function validateReferences(scope: AuthzScope, fact: ClinicalFact): void {
  const sqlite = getSqlite();
  for (const source of fact.provenance.sources) {
    if (
      source.document_id &&
      !sqlite
        .prepare('SELECT id FROM import_batches WHERE id=? AND user_id=? AND dependent_id IS ?')
        .get(source.document_id, scope.ownerId, scope.dependentId)
    )
      throw new FitnessWriteError('A source document is not available for this person.');
  }
  if (fact.kind === 'medication_event') {
    const medication = recordInScope(scope, fact.medication_id);
    if (!medication || medication.kind !== 'medication')
      throw new FitnessWriteError('Select a medication belonging to this person.');
  }
  if (fact.kind === 'screening' && fact.copied_from_record_id) {
    const source = recordInScope(scope, fact.copied_from_record_id);
    if (!source || source.kind !== 'screening')
      throw new FitnessWriteError('The copied screening record is not available for this person.');
  }
  if (fact.kind === 'lab')
    for (const id of fact.medication_event_ids ?? []) {
      const event = recordInScope(scope, id);
      if (!event || event.kind !== 'medication_event')
        throw new FitnessWriteError('A linked dose event is not available for this person.');
    }
}
function semantics(fact: ClinicalFact): unknown {
  // Raw text, qualifiers, regimen, reference intervals and source units matter.
  return Object.fromEntries(Object.entries(fact).filter(([key]) => key !== 'provenance'));
}
function knownLabIdentity(value: string | null | undefined): value is string {
  return Boolean(
    value?.trim() &&
    !/^(?:unknown|n\/?a|none|null|nil|not[ _-]+(?:available|applicable|provided|reported|known)|unspecified|unavailable|missing|pending|tbd|undetermined|[-?]+)$/i.test(
      value.trim()
    )
  );
}
function exactLabIdentity(
  a: Extract<ClinicalFact, { kind: 'lab' }>,
  b: Extract<ClinicalFact, { kind: 'lab' }>
): boolean {
  if (
    a.collection_date.precision === 'unknown' ||
    b.collection_date.precision === 'unknown' ||
    !['day', 'instant'].includes(a.collection_date.precision) ||
    a.collection_date.value !== b.collection_date.value
  )
    return false;
  if (
    ['accession_id', 'specimen_id', 'report_id', 'specimen_type'].some(
      (key) =>
        a[key as keyof typeof a] &&
        b[key as keyof typeof b] &&
        a[key as keyof typeof a] !== b[key as keyof typeof b]
    )
  )
    return false;
  return Boolean(
    (knownLabIdentity(a.accession_id) && a.accession_id === b.accession_id) ||
    (knownLabIdentity(a.specimen_id) && a.specimen_id === b.specimen_id) ||
    (knownLabIdentity(a.report_id) && a.report_id === b.report_id)
  );
}
function classify(fact: ClinicalFact, record: FidelityRecord): ClinicalMatch | null {
  const other = record.fact;
  if (fact.kind !== other.kind) return null;
  let related = false;
  let exact = false;
  if (fact.kind === 'lab' && other.kind === 'lab') {
    related =
      normalizedName(fact.test_name) === normalizedName(other.test_name) ||
      Boolean(fact.loinc_code && fact.loinc_code === other.loinc_code);
    exact =
      exactLabIdentity(fact, other) &&
      canonicalJson(semantics(fact)) === canonicalJson(semantics(other));
  } else if (fact.kind === 'medication' && other.kind === 'medication') {
    related =
      normalizedName(fact.name) === normalizedName(other.name) ||
      Boolean(fact.rxcui && fact.rxcui === other.rxcui);
    // Neither a name nor a copied document proves that two medication courses are one.
    exact = false;
  } else if (fact.kind === 'medication_event' && other.kind === 'medication_event') {
    related = fact.medication_id === other.medication_id;
    exact = false;
  } else {
    const name = (f: ClinicalFact) =>
      'name' in f
        ? f.name
        : f.kind === 'screening'
          ? f.instrument.name
          : f.kind === 'allergy_review'
            ? f.scope
            : '';
    const identity = (f: ClinicalFact) =>
      f.kind === 'encounter'
        ? f.encounter_id
        : f.kind === 'sleep_study'
          ? f.study_id
          : f.kind === 'pap_report'
            ? f.report_id
            : undefined;
    const a = identity(fact),
      b = identity(other);
    related =
      normalizedName(name(fact)) === normalizedName(name(other)) ||
      Boolean(knownLabIdentity(a) && a === b);
    // Report/encounter identity plus equal content can establish a duplicate.
    // Dates/names, copied screening scores, and condition/procedure status alone cannot.
    exact = Boolean(
      knownLabIdentity(a) &&
      a === b &&
      canonicalJson(semantics(fact)) === canonicalJson(semantics(other))
    );
  }
  if (!related) return null;
  const classification = exact
    ? 'duplicate'
    : canonicalJson(semantics(fact)) === canonicalJson(semantics(other))
      ? 'possible'
      : 'conflict';
  return {
    id: record.id,
    revision: record.revision,
    fact: record.fact,
    legacy: Boolean(record.legacy),
    classification,
  };
}
function matchingFor(scope: AuthzScope, item: IntakeItem) {
  const sqlite = getSqlite(),
    fact = item.fact;
  sqlite.function('hf_clinical_name', { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? normalizedName(value) : ''
  );
  const relation =
    fact.kind === 'lab'
      ? {
          sql: "(hf_clinical_name(json_extract(payload_json,'$.test_name'))=? OR (? IS NOT NULL AND json_extract(payload_json,'$.loinc_code')=?))",
          args: [normalizedName(fact.test_name), fact.loinc_code ?? null, fact.loinc_code ?? null],
        }
      : fact.kind === 'medication'
        ? {
            sql: "(hf_clinical_name(json_extract(payload_json,'$.name'))=? OR (? IS NOT NULL AND json_extract(payload_json,'$.rxcui')=?))",
            args: [normalizedName(fact.name), fact.rxcui ?? null, fact.rxcui ?? null],
          }
        : fact.kind === 'medication_event'
          ? { sql: "json_extract(payload_json,'$.medication_id')=?", args: [fact.medication_id] }
          : { sql: '1=1', args: [] };
  const matches: ClinicalMatch[] = [],
    hash = createHash('sha256');
  let count = 0,
    selectedSeen = false;
  function consider(record: FidelityRecord) {
    if (record.legacy) {
      const table = legacyTable(record.kind);
      const overlay = sqlite
        .prepare(
          'SELECT * FROM clinical_records WHERE user_id=? AND dependent_id IS ? AND legacy_table=? AND legacy_id=?'
        )
        .get(
          scope.ownerId,
          scope.dependentId,
          table,
          record.id.slice(`legacy:${record.kind}:`.length)
        ) as SqlRecord | undefined;
      if (overlay && !typedRow(overlay).legacy_conflict && record.id !== item.target_id) return;
    }
    const match =
      classify(item.fact, record) ??
      (record.id === item.target_id
        ? {
            id: record.id,
            revision: record.revision,
            fact: record.fact,
            legacy: Boolean(record.legacy),
            classification: 'conflict' as const,
          }
        : null);
    if (match && record.legacy_conflict && record.supersedes_legacy) {
      match.legacy_conflict = true;
      match.current_legacy = legacyRecord(
        scope,
        record.supersedes_legacy.table,
        record.supersedes_legacy.id
      )?.fact;
    }
    if (!match) return;
    selectedSeen ||= record.id === item.target_id;
    count++;
    hash.update(canonicalJson({ id: match.id, revision: match.revision }));
    // Keep preview memory bounded, but scan and fingerprint every related row.
    // Confirmed duplicates and the explicitly selected target must never fall off the preview.
    if (
      matches.length < 100 ||
      match.classification === 'duplicate' ||
      match.id === item.target_id
    ) {
      matches.push(match);
      matches.sort(
        (a, b) =>
          Number(b.id === item.target_id) - Number(a.id === item.target_id) ||
          Number(b.classification === 'duplicate') - Number(a.classification === 'duplicate') ||
          a.id.localeCompare(b.id)
      );
      matches.splice(100);
    }
  }
  const rows = sqlite
    .prepare(
      `SELECT * FROM clinical_records WHERE user_id=? AND dependent_id IS ? AND kind=? AND ${relation.sql} ORDER BY id`
    )
    .iterate(scope.ownerId, scope.dependentId, fact.kind, ...relation.args);
  for (const row of rows) consider(typedRow(row as SqlRecord));
  if (fact.kind === 'medication') {
    for (const row of sqlite
      .prepare(
        'SELECT * FROM medications WHERE user_id=? AND dependent_id IS ? AND (hf_clinical_name(name)=? OR (? IS NOT NULL AND rxcui=?)) ORDER BY id'
      )
      .iterate(
        scope.ownerId,
        scope.dependentId,
        normalizedName(fact.name),
        fact.rxcui ?? null,
        fact.rxcui ?? null
      ))
      consider(legacyMed(row as Record<string, unknown>));
  } else if (fact.kind === 'lab') {
    for (const row of sqlite
      .prepare(
        'SELECT r.*,v.visit_date,v.source_pdf_path FROM lab_results r JOIN lab_visits v ON v.id=r.lab_visit_id AND v.user_id=r.user_id AND v.dependent_id IS r.dependent_id WHERE r.user_id=? AND r.dependent_id IS ? AND (hf_clinical_name(r.test_name)=? OR (? IS NOT NULL AND r.loinc_code=?)) ORDER BY r.id'
      )
      .iterate(
        scope.ownerId,
        scope.dependentId,
        normalizedName(fact.test_name),
        fact.loinc_code ?? null,
        fact.loinc_code ?? null
      ))
      consider(legacyLab(row as Record<string, unknown>));
  } else if (fact.kind === 'condition' || fact.kind === 'procedure') {
    for (const row of sqlite
      .prepare(
        `SELECT * FROM ${legacyTables[fact.kind]} WHERE user_id=? AND dependent_id IS ? ORDER BY id`
      )
      .iterate(scope.ownerId, scope.dependentId))
      consider(legacyClinical(row as Record<string, unknown>, fact.kind));
  }
  if (item.target_id && !selectedSeen) {
    const selected = recordInScope(scope, item.target_id);
    if (selected) consider(selected);
  }
  return {
    matches: matches.sort((a, b) => a.id.localeCompare(b.id)),
    matching_count: count,
    matching_revision: hash.digest('hex'),
  };
}
function batchRow(actorId: string, id: string, selfOnly = false): Batch {
  const row = getSqlite()
    .prepare(
      `SELECT * FROM clinical_intake_batches WHERE id=? AND user_id=?${selfOnly ? ' AND dependent_id IS NULL' : ''}`
    )
    .get(id, actorId) as Batch | undefined;
  if (!row) throw new NotFoundError();
  return row;
}
function review(row: Batch): ClinicalReview {
  const input = intakeSchema.parse(JSON.parse(row.payload_json));
  const scope = { ownerId: row.user_id, dependentId: row.dependent_id };
  const stored = getSqlite()
    .prepare('SELECT item_key,outcome_json FROM clinical_intake_items WHERE batch_id=?')
    .all(row.id) as { item_key: string; outcome_json: string | null }[];
  const items: ClinicalReviewItem[] = input.items.map((item) => ({
    ...item,
    ...matchingFor(scope, item),
    outcome: JSON.parse(stored.find((s) => s.item_key === item.item_key)?.outcome_json ?? 'null'),
  }));
  const digest =
    row.approved_digest ??
    approvalDigest(
      row.user_id,
      row.dependent_id,
      row.id,
      row.version,
      items.map((item) =>
        Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'outcome'))
      )
    );
  const counts: Record<string, number> = {
    created: 0,
    corrected: 0,
    linked: 0,
    skipped: 0,
    unresolved: 0,
    pending: 0,
  };
  for (const item of items) counts[item.outcome?.status ?? 'pending']++;
  const documentIds = [
    ...new Set(
      input.items.flatMap((item) =>
        item.fact.provenance.sources
          .map((source) => source.document_id)
          .filter((id): id is string => Boolean(id))
      )
    ),
  ];
  const documents = documentIds.slice(0, 50).flatMap((id) => {
    const document = getSqlite()
      .prepare(
        "SELECT id,file_name,status FROM import_batches WHERE id=? AND user_id=? AND dependent_id IS ? AND kind='clinical_labs'"
      )
      .get(id, row.user_id, row.dependent_id) as
      | { id: string; file_name: string; status: string }
      | undefined;
    if (!document) return [];
    const held = getSqlite()
      .prepare("SELECT count(*) n FROM import_items WHERE batch_id=? AND status='held'")
      .get(id) as { n: number };
    const pending = getSqlite()
      .prepare("SELECT count(*) n FROM import_items WHERE batch_id=? AND status='source_evidence'")
      .get(id) as { n: number };
    return [{ ...document, held: held.n, pending: pending.n }];
  });
  return {
    id: row.id,
    user_id: row.user_id,
    dependent_id: row.dependent_id,
    external_id: row.external_id,
    version: row.version,
    digest,
    approved_at: row.approved_at,
    received_at: row.received_at,
    items,
    counts,
    coverage: [
      'Detailed results and source history are available here. Numeric-only charts and older API views may omit some results, including non-numeric ones.',
      'Review shows up to 100 possible matches per item. If more exist, select the correct record or add separately with a reason. Records are checked again when you save.',
      ...documents
        .filter((d) => d.held > 0)
        .map(
          (d) =>
            `${d.file_name}: ${d.held} unsupported source row(s) remain held outside this batch.`
        ),
      ...(documentIds.length > 50
        ? ['Document metadata is limited to the first 50 referenced documents.']
        : []),
    ],
    documents,
  };
}
export async function stageClinicalIntake(
  actorId: string,
  scope: AuthzScope,
  input: unknown
): Promise<ClinicalReview> {
  await requireOwner(actorId, scope);
  const parsed = intakeSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > 512 * 1024)
    throw new FitnessWriteError('Clinical intake exceeds 512 KiB. Split it into smaller batches.');
  for (const item of parsed.items) if (item.action !== 'skip') validateReferences(scope, item.fact);
  const sqlite = getSqlite();
  const id = sqlite
    .transaction(() => {
      const existing = sqlite
        .prepare(
          'SELECT * FROM clinical_intake_batches WHERE user_id=? AND dependent_id IS ? AND external_id=?'
        )
        .get(scope.ownerId, scope.dependentId, parsed.external_id) as Batch | undefined;
      if (existing) {
        if (canonicalJson(JSON.parse(existing.payload_json)) !== canonicalJson(parsed))
          throw new FitnessConflictError(
            'This import identity already has different content. Reopen it in the app or use a new identity.'
          );
        return existing.id;
      }
      const id = randomUUID(),
        now = new Date().toISOString();
      sqlite
        .prepare(
          'INSERT INTO clinical_intake_batches(id,user_id,dependent_id,external_id,payload_json,digest,received_at,updated_at)VALUES(?,?,?,?,?,?,?,?)'
        )
        .run(
          id,
          scope.ownerId,
          scope.dependentId,
          parsed.external_id,
          JSON.stringify(parsed),
          approvalDigest(scope.ownerId, scope.dependentId, id, 1, parsed.items),
          now,
          now
        );
      for (const item of parsed.items)
        sqlite
          .prepare(
            'INSERT INTO clinical_intake_items(id,batch_id,item_key,payload_json)VALUES(?,?,?,?)'
          )
          .run(randomUUID(), id, item.item_key, JSON.stringify(item));
      return id;
    })
    .immediate();
  return getClinicalIntake(actorId, id);
}
export async function listClinicalIntakes(
  actorId: string,
  dependentId: string | null = null
): Promise<ClinicalReview[]> {
  await requireOwner(actorId, { ownerId: actorId, dependentId });
  const rows = getSqlite()
    .prepare(
      'SELECT * FROM clinical_intake_batches WHERE user_id=? AND dependent_id IS ? ORDER BY received_at DESC,id LIMIT 50'
    )
    .all(actorId, dependentId) as Batch[];
  return rows.map(review);
}
export async function getClinicalIntake(
  actorId: string,
  id: string,
  selfOnly = false
): Promise<ClinicalReview> {
  const row = batchRow(actorId, id, selfOnly);
  await requireOwner(actorId, { ownerId: row.user_id, dependentId: row.dependent_id });
  return review(row);
}
export const revisionInputSchema = z
  .object({ expected_version: z.number().int().positive(), intake: intakeSchema })
  .strict();
export async function reviseClinicalIntake(
  actorId: string,
  id: string,
  input: unknown
): Promise<ClinicalReview> {
  const parsed = revisionInputSchema.parse(input);
  const row = batchRow(actorId, id);
  const scope = { ownerId: row.user_id, dependentId: row.dependent_id };
  await requireOwner(actorId, scope);
  if (Buffer.byteLength(JSON.stringify(parsed.intake), 'utf8') > 512 * 1024)
    throw new FitnessWriteError('Clinical intake exceeds 512 KiB.');
  for (const item of parsed.intake.items)
    if (item.action !== 'skip') validateReferences(scope, item.fact);
  getSqlite()
    .transaction(() => {
      const current = batchRow(actorId, id);
      if (current.approved_at)
        throw new FitnessConflictError(
          'Accepted imports cannot be revised. Stage an audited correction instead.'
        );
      if (current.version !== parsed.expected_version)
        throw new FitnessConflictError('This preview changed. Reload it before editing.');
      if (parsed.intake.external_id !== current.external_id)
        throw new FitnessWriteError('The import identity cannot change.');
      const nextVersion = current.version + 1;
      getSqlite()
        .prepare(
          'UPDATE clinical_intake_batches SET payload_json=?,version=?,digest=?,updated_at=? WHERE id=?'
        )
        .run(
          JSON.stringify(parsed.intake),
          nextVersion,
          approvalDigest(actorId, current.dependent_id, id, nextVersion, parsed.intake.items),
          new Date().toISOString(),
          id
        );
      getSqlite().prepare('DELETE FROM clinical_intake_items WHERE batch_id=?').run(id);
      for (const item of parsed.intake.items)
        getSqlite()
          .prepare(
            'INSERT INTO clinical_intake_items(id,batch_id,item_key,payload_json)VALUES(?,?,?,?)'
          )
          .run(randomUUID(), id, item.item_key, JSON.stringify(item));
    })
    .immediate();
  return getClinicalIntake(actorId, id);
}
function mergeSources(target: ClinicalFact, incoming: ClinicalFact): ClinicalFact {
  if (canonicalJson(semantics(target)) !== canonicalJson(semantics(incoming)))
    throw new FitnessWriteError(
      'These values differ. Add separately or explicitly correct the selected record.'
    );
  const sources = [...target.provenance.sources];
  for (const source of incoming.provenance.sources)
    if (!sources.some((s) => canonicalJson(s) === canonicalJson(source))) sources.push(source);
  return clinicalFactSchema.parse({ ...target, provenance: { ...target.provenance, sources } });
}
function writeFact(
  scope: AuthzScope,
  id: string,
  fact: ClinicalFact,
  previous: FidelityRecord | null,
  itemId: string,
  reason: string,
  reconcileLegacy = false
): void {
  const sqlite = getSqlite(),
    now = new Date().toISOString();
  if (previous) {
    const legacyRevision =
      reconcileLegacy && previous.supersedes_legacy
        ? (legacyRecord(scope, previous.supersedes_legacy.table, previous.supersedes_legacy.id)
            ?.revision ?? previous.supersedes_legacy.revision)
        : (previous.supersedes_legacy?.revision ?? null);
    sqlite
      .prepare(
        'UPDATE clinical_records SET payload_json=?,revision=revision+1,updated_at=?,legacy_revision=? WHERE id=? AND user_id=? AND dependent_id IS ?'
      )
      .run(JSON.stringify(fact), now, legacyRevision, id, scope.ownerId, scope.dependentId);
    sqlite
      .prepare(
        'INSERT INTO clinical_corrections(id,user_id,dependent_id,domain,record_id,before_json,after_json,reason)VALUES(?,?,?,?,?,?,?,?)'
      )
      .run(
        randomUUID(),
        scope.ownerId,
        scope.dependentId,
        'clinical_records',
        id,
        JSON.stringify({ fact: previous.fact, revision: previous.revision }),
        JSON.stringify({ fact, intake_item_id: itemId }),
        reason
      );
  } else
    sqlite
      .prepare(
        'INSERT INTO clinical_records(id,user_id,dependent_id,kind,payload_json,received_at,updated_at)VALUES(?,?,?,?,?,?,?)'
      )
      .run(id, scope.ownerId, scope.dependentId, fact.kind, JSON.stringify(fact), now, now);
  if (fact.kind === 'medication' || fact.kind === 'medication_event')
    invalidateInteractionCheck(scope.ownerId, scope.dependentId);
}
function resolveTypedSource(scope: AuthzScope, fact: ClinicalFact, outcome: ClinicalOutcome) {
  if (outcome.status === 'unresolved') return;
  const sqlite = getSqlite();
  for (const source of fact.provenance.sources) {
    const marker = source.reference.match(/clinical-source-item:([a-f0-9-]{36})/i);
    if (!source.document_id || !marker) continue;
    const item = sqlite
      .prepare(
        "SELECT i.id FROM import_items i JOIN import_batches b ON b.id=i.batch_id WHERE i.id=? AND b.id=? AND b.user_id=? AND b.dependent_id IS ? AND b.kind='clinical_labs'"
      )
      .get(marker[1], source.document_id, scope.ownerId, scope.dependentId);
    if (!item && outcome.status === 'skipped') continue;
    if (!item)
      throw new FitnessWriteError('The retained source row is not available for this person.');
    sqlite
      .prepare('UPDATE import_items SET status=?,record_id=?,action=?,applied_payload=? WHERE id=?')
      .run(
        outcome.status === 'skipped' ? 'typed_skipped' : 'typed_resolved',
        outcome.record_id,
        outcome.status,
        JSON.stringify(fact),
        marker[1]
      );
    const counts = sqlite
      .prepare(
        "SELECT SUM(CASE WHEN status='held' THEN 1 ELSE 0 END) held,SUM(CASE WHEN status='source_evidence' THEN 1 ELSE 0 END) pending FROM import_items WHERE batch_id=?"
      )
      .get(source.document_id) as { held: number; pending: number };
    const row = sqlite
      .prepare('SELECT warnings FROM import_batches WHERE id=?')
      .get(source.document_id) as { warnings: string };
    const warnings = (JSON.parse(row.warnings) as string[]).filter(
      (w) => !/^\d+ source row\(s\) are held/.test(w)
    );
    if (counts.held)
      warnings.push(
        `${counts.held} source row(s) are held outside the accepted batch. No unsupported row was discarded.`
      );
    sqlite
      .prepare('UPDATE import_batches SET status=?,warnings=?,updated_at=? WHERE id=?')
      .run(
        counts.held ? 'incomplete' : counts.pending ? 'pending_typed_review' : 'complete',
        JSON.stringify(warnings),
        new Date().toISOString(),
        source.document_id
      );
  }
}
export const approvalInputSchema = z
  .object({ version: z.number().int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
/** Called ONLY by the session+same-origin owner approval route, never a PAT route. */
export async function approveClinicalIntake(
  actorId: string,
  id: string,
  input: unknown
): Promise<ClinicalReview> {
  const approval = approvalInputSchema.parse(input),
    initial = batchRow(actorId, id);
  const scope = { ownerId: initial.user_id, dependentId: initial.dependent_id };
  await requireOwner(actorId, scope);
  getSqlite()
    .transaction(() => {
      const row = batchRow(actorId, id);
      if (row.approved_at) {
        if (row.approved_digest !== approval.digest || row.version !== approval.version)
          throw new FitnessConflictError('This approval does not match the accepted import.');
        return;
      }
      const preview = review(row);
      if (row.version !== approval.version || preview.digest !== approval.digest)
        throw new FitnessConflictError(
          'The batch, person, or matching records changed. Reload and review before approving.'
        );
      const sqlite = getSqlite();
      const writeOutcome = (item: ClinicalReviewItem, outcome: ClinicalOutcome) => {
        sqlite
          .prepare(
            'UPDATE clinical_intake_items SET status=?,record_id=?,outcome_json=? WHERE batch_id=? AND item_key=?'
          )
          .run(outcome.status, outcome.record_id, JSON.stringify(outcome), id, item.item_key);
        resolveTypedSource(scope, item.fact, outcome);
      };
      for (const item of preview.items) {
        const result = (
          status: ClinicalOutcome['status'],
          recordId: string | null,
          reason: string
        ) => writeOutcome(item, { item_key: item.item_key, status, record_id: recordId, reason });
        if (item.action === 'skip') {
          result('skipped', null, 'Skipped by owner.');
          continue;
        }
        validateReferences(scope, item.fact);
        if (item.action === 'add') {
          const currentMatches = matchingFor(scope, item).matches,
            duplicate = currentMatches.find((m) => m.classification === 'duplicate');
          if (duplicate) {
            result('skipped', duplicate.id, 'Confirmed duplicate; existing record retained.');
            continue;
          }
          if (currentMatches.length && !item.reason) {
            result(
              'unresolved',
              null,
              'Possible matches require a selected target or an explicit add-separately reason.'
            );
            continue;
          }
          const recordId = randomUUID();
          writeFact(
            scope,
            recordId,
            item.fact,
            null,
            item.item_key,
            item.reason ?? 'Owner-approved new fact'
          );
          result('created', recordId, 'Created separately after owner approval.');
          continue;
        }
        const target = item.target_id ? recordInScope(scope, item.target_id) : null;
        if (!target || target.kind !== item.fact.kind)
          throw new FitnessConflictError('The selected record is not available for this person.');
        if (target.revision !== item.expected_revision)
          throw new FitnessConflictError('The selected record changed. Reload and review again.');
        if (item.action === 'link') {
          const merged = mergeSources(target.fact, item.fact);
          if (!target.legacy)
            writeFact(
              scope,
              target.id,
              merged,
              target,
              item.item_key,
              item.reason ?? 'Owner-approved evidence link'
            );
          result(
            'linked',
            target.id,
            target.legacy
              ? 'Linked to the unchanged legacy record; source evidence remains in this accepted batch.'
              : 'Linked source evidence without replacing clinical values.'
          );
          continue;
        }
        if (!item.reason) throw new FitnessWriteError('A correction reason is required.');
        if (target.legacy) {
          const table = legacyTable(target.kind),
            legacyId = target.id.slice(`legacy:${target.kind}:`.length);
          if (!table) throw new FitnessConflictError('This record has no supported legacy source.');
          if (
            sqlite
              .prepare(
                'SELECT id FROM clinical_records WHERE user_id=? AND dependent_id IS ? AND legacy_table=? AND legacy_id=?'
              )
              .get(scope.ownerId, scope.dependentId, table, legacyId)
          )
            throw new FitnessConflictError(
              'This legacy record already has a typed overlay. Select that typed record for correction.'
            );
          const recordId = randomUUID(),
            now = new Date().toISOString();
          sqlite
            .prepare(
              'INSERT INTO clinical_records(id,user_id,dependent_id,kind,payload_json,legacy_table,legacy_id,legacy_revision,received_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?,?)'
            )
            .run(
              recordId,
              scope.ownerId,
              scope.dependentId,
              item.fact.kind,
              JSON.stringify(item.fact),
              table,
              legacyId,
              target.revision,
              now,
              now
            );
          sqlite
            .prepare(
              'INSERT INTO clinical_corrections(id,user_id,dependent_id,domain,record_id,before_json,after_json,reason)VALUES(?,?,?,?,?,?,?,?)'
            )
            .run(
              randomUUID(),
              scope.ownerId,
              scope.dependentId,
              'clinical_records',
              recordId,
              JSON.stringify(target),
              JSON.stringify({
                fact: item.fact,
                supersedes_legacy: { table, id: legacyId, revision: target.revision },
                intake_item_id: item.item_key,
              }),
              item.reason
            );
          if (item.fact.kind === 'medication')
            invalidateInteractionCheck(scope.ownerId, scope.dependentId);
          result(
            'corrected',
            recordId,
            'Typed correction overlays the unchanged legacy source; previous values and provenance remain audited.'
          );
          continue;
        }
        writeFact(scope, target.id, item.fact, target, item.item_key, item.reason, true);
        result(
          'corrected',
          target.id,
          'Selected record corrected; prior values and source evidence retained in the audit.'
        );
      }
      // Resolve held items in a new reviewed batch; accepted outcomes stay immutable/retry-safe.
      sqlite
        .prepare(
          'UPDATE clinical_intake_batches SET approved_at=?,approved_digest=?,updated_at=? WHERE id=?'
        )
        .run(new Date().toISOString(), approval.digest, new Date().toISOString(), id);
    })
    .immediate();
  return getClinicalIntake(actorId, id);
}

export async function canReadClinicalKind(
  actorId: string,
  scope: AuthzScope,
  kind: Kind
): Promise<boolean> {
  return authorize(actorId, scope, section(kind), 'read');
}

export async function clinicalProjectionCoverage(
  actorId: string,
  scope: ListScope,
  kind: 'lab' | 'medication' | 'condition' | 'procedure'
) {
  await requireListAuthz(actorId, scope, section(kind), 'read');
  const sqlite = getSqlite(),
    table = legacyTables[kind],
    where = scopedWhere(scope, 'l');
  const omitted = sqlite
    .prepare(
      `SELECT count(*) n FROM ${table} l WHERE ${where.sql} AND EXISTS(SELECT 1 FROM clinical_records hf WHERE hf.user_id=l.user_id AND hf.dependent_id IS l.dependent_id AND hf.legacy_table=? AND hf.legacy_id=l.id)`
    )
    .get(...where.args, table) as { n: number };
  const typedWhere = scopedWhere(scope);
  const typed = sqlite
    .prepare(`SELECT count(*) n FROM clinical_records WHERE ${typedWhere.sql} AND kind=?`)
    .get(...typedWhere.args, kind) as { n: number };
  return {
    superseded_legacy_omitted: omitted.n,
    typed_records: typed.n,
    warning:
      'Legacy projection omits typed facts and every superseded original, including unresolved conflicts. Use format=typed for current values and conflict evidence.',
  };
}
