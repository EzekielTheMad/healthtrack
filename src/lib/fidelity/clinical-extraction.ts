/** Controlled generic lab extraction adapter. It preserves unsupported rows as held evidence. */
import { randomUUID } from 'node:crypto';
import { getSqlite } from '@/db';
import { NotFoundError, requireAuthz } from '@/lib/authz';
import { FitnessWriteError } from '@/lib/repos/_fitness';
import {
  clinicalDateSchema,
  clinicalFactSchema,
  labOutcomeSchema,
  intakeSchema,
  unknownClinicalDate,
  type ClinicalDate,
  type ClinicalIntake,
} from './contracts';
import { stageClinicalIntake } from './clinical';
import { contentRevision } from './security';

type Row = Record<string, unknown>;
export type HeldLabEvidence = {
  item_key: string;
  source_row: unknown;
  issues: string[];
  source_item_id?: string;
};
export type TypedLabAdaptation = {
  intake: ClinicalIntake | null;
  held: HeldLabEvidence[];
  warnings: string[];
};
const fields = new Set([
  'test_name',
  'outcome',
  'value',
  'raw_result',
  'raw_text',
  'source_unit',
  'unit',
  'collection_date',
  'visit_date',
  'collected_at',
  'report_date',
  'panel_name',
  'report_id',
  'accession_id',
  'specimen_id',
  'specimen_type',
  'loinc_code',
  'source_page',
  'source_pages',
  'printed_flags',
  'flag',
  'derived_flag',
  'reference',
  'reference_range_low',
  'reference_range_high',
  'reference_range_text',
  'confidence',
  'normalized',
  'fasting_status',
  'cancel_reason',
]);
const string = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
function clinicalDate(value: unknown): ClinicalDate {
  if (value && typeof value === 'object') return clinicalDateSchema.parse(value);
  const source = string(value);
  if (!source) return unknownClinicalDate();
  const precision = /^\d{4}$/.test(source)
    ? 'year'
    : /^\d{4}-\d{2}$/.test(source)
      ? 'month'
      : /^\d{4}-\d{2}-\d{2}$/.test(source)
        ? 'day'
        : 'instant';
  const parsed = clinicalDateSchema.safeParse({ precision, value: source, original_text: source });
  return parsed.success ? parsed.data : unknownClinicalDate(source);
}
function outcome(row: Row) {
  const printed = string(row.raw_result) ?? string(row.raw_text);
  const valueText = string(row.value);
  const raw = printed ?? valueText;
  const numeric = raw?.match(
    /^\s*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%/µμ][\w%/µμ. -]*)?$/u
  );
  const extractedNumber =
    typeof row.value === 'number'
      ? row.value
      : typeof row.value === 'string' && /^\s*-?(?:\d+(?:\.\d+)?|\.\d+)\s*$/.test(row.value)
        ? Number(row.value)
        : undefined;
  const bound = raw?.match(
    /^\s*(<=|>=|<|>|≤|≥)\s*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%/µμ][\w%/µμ. -]*)?$/u
  );
  // Legacy-shaped extraction can contain a numeric projection alongside printed
  // qualitative/canceled evidence. Neither field may silently replace the other.
  if (
    extractedNumber !== undefined &&
    (!Number.isFinite(extractedNumber) ||
      (raw &&
        (bound
          ? extractedNumber !== Number(bound[2])
          : !numeric || extractedNumber !== Number(numeric[1]))))
  )
    throw new FitnessWriteError(
      'The numeric extraction and printed result disagree. Resolve the retained source evidence explicitly.'
    );
  if (
    extractedNumber === undefined &&
    printed &&
    valueText &&
    valueText.toLocaleLowerCase('en-US').replace(/\s+/g, ' ') !==
      printed.toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
  )
    throw new FitnessWriteError(
      'The extracted value and printed result disagree. Resolve the retained source evidence explicitly.'
    );
  const sourceUnit = string(row.source_unit),
    legacyUnit = string(row.unit),
    declaredUnit = sourceUnit ?? legacyUnit;
  const printedUnit = string(bound?.[3] ?? numeric?.[2]);
  const sameUnit = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
  if (
    (sourceUnit && legacyUnit && !sameUnit(sourceUnit, legacyUnit)) ||
    (printedUnit && declaredUnit && !sameUnit(printedUnit, declaredUnit))
  )
    throw new FitnessWriteError(
      'Printed and extracted units disagree. Resolve the retained source evidence explicitly; no unit conversion was applied.'
    );
  if (row.outcome !== undefined) {
    const parsed = labOutcomeSchema.parse(row.outcome);
    const normalizedText = (value: string) =>
      value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
    let compatible = true;
    if (bound)
      compatible =
        parsed.kind === 'censored' &&
        parsed.value === Number(bound[2]) &&
        parsed.comparator === bound[1].replace('≤', '<=').replace('≥', '>=');
    else if (numeric || extractedNumber !== undefined)
      compatible =
        parsed.kind === 'numeric' &&
        parsed.value === (numeric ? Number(numeric[1]) : extractedNumber);
    else if (raw && /^(?:cancelled|canceled|not performed)(?:\b|$)/i.test(raw))
      compatible =
        parsed.kind === 'canceled' &&
        (!parsed.reason ||
          normalizedText(raw) === normalizedText(parsed.reason) ||
          normalizedText(raw.replace(/^(?:cancelled|canceled|not performed)\b[\s:;-]*/i, '')) ===
            normalizedText(parsed.reason));
    else if (raw)
      compatible = parsed.kind === 'text' && normalizedText(parsed.text) === normalizedText(raw);
    if (!compatible)
      throw new FitnessWriteError(
        'The typed outcome and printed result disagree. Resolve the retained source evidence explicitly.'
      );
    return parsed;
  }
  if (bound) {
    const value = Number(bound[2]);
    return labOutcomeSchema.parse({
      kind: 'censored',
      comparator: bound[1].replace('≤', '<=').replace('≥', '>='),
      value,
    });
  }
  if (extractedNumber !== undefined)
    return labOutcomeSchema.parse({ kind: 'numeric', value: extractedNumber, comparator: '=' });
  if (raw && /^(?:cancelled|canceled|not performed)(?:\b|$)/i.test(raw))
    return labOutcomeSchema.parse({ kind: 'canceled', reason: raw });
  if (raw && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw))
    return labOutcomeSchema.parse({ kind: 'numeric', value: Number(raw), comparator: '=' });
  if (raw) return labOutcomeSchema.parse({ kind: 'text', text: raw });
  throw new FitnessWriteError(
    'No supported result outcome was recognized. Resolve this source row explicitly.'
  );
}
export function adaptTypedLabExtraction(
  raw: unknown,
  options: { externalId: string; documentId?: string; reference: string; aiNote?: string }
): TypedLabAdaptation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray((raw as Row).results))
    throw new FitnessWriteError(
      'Typed extraction must contain a results array. The source is retained for retry.'
    );
  const report = raw as Row,
    rows = report.results as unknown[];
  if (rows.length > 2000 || Buffer.byteLength(JSON.stringify(raw), 'utf8') > 512 * 1024)
    throw new FitnessWriteError(
      'Extraction exceeds the bounded 2,000-row/512-KiB review limit. Split the document.'
    );
  const items: ClinicalIntake['items'] = [],
    held: HeldLabEvidence[] = [],
    warnings = Array.isArray(report.warnings)
      ? report.warnings
          .filter((w): w is string => typeof w === 'string')
          .map((w) => w.slice(0, 1000))
          .slice(0, 50)
      : [];
  rows.forEach((source, index) => {
    const key = 'result-' + (index + 1);
    try {
      if (!source || typeof source !== 'object' || Array.isArray(source))
        throw new FitnessWriteError('A result must be an object.');
      const row = source as Row;
      const unknown = Object.keys(row).filter((key) => !fields.has(key));
      if (unknown.length)
        throw new FitnessWriteError(
          'Unsupported extracted fields retained for review: ' + unknown.join(', ')
        );
      if (items.length >= 100)
        throw new FitnessWriteError(
          'This row exceeds the 100-item batch limit. Split retained source evidence into another typed batch.'
        );
      const collection = clinicalDate(
        row.collection_date ??
          row.collected_at ??
          row.visit_date ??
          (report.multiple_collection_dates ? null : report.visit_date)
      );
      const reportDate = clinicalDate(row.report_date ?? report.report_date);
      const pages = row.source_pages;
      if (
        pages !== undefined &&
        (!Array.isArray(pages) || pages.some((page) => !Number.isInteger(page) || Number(page) < 1))
      )
        throw new FitnessWriteError('Source page evidence is invalid.');
      const page = row.source_page ?? (Array.isArray(pages) ? pages[0] : undefined);
      if (page !== undefined && page !== null && (!Number.isInteger(page) || Number(page) < 1))
        throw new FitnessWriteError('Source page must be a positive integer.');
      const reference = row.reference ?? {
        low: row.reference_range_low ?? null,
        high: row.reference_range_high ?? null,
        text: row.reference_range_text ?? null,
      };
      const legacyFlag = string(row.flag);
      const printed = row.printed_flags ?? [];
      const fact = clinicalFactSchema.parse({
        kind: 'lab',
        test_name: row.test_name,
        outcome: outcome(row),
        raw_result:
          string(row.raw_result) ??
          string(row.raw_text) ??
          (row.value !== undefined && row.value !== null && typeof row.value !== 'object'
            ? String(row.value)
            : undefined),
        source_unit: row.source_unit ?? row.unit ?? null,
        normalized: row.normalized,
        reference,
        printed_flags: printed,
        derived_flag: row.derived_flag,
        collection_date: collection,
        report_date: reportDate,
        panel_name: row.panel_name,
        report_id: row.report_id,
        accession_id: row.accession_id,
        specimen_id: row.specimen_id,
        specimen_type: row.specimen_type,
        loinc_code: row.loinc_code,
        fasting_status: row.fasting_status,
        provenance: {
          basis: 'source_reported',
          verification: 'unconfirmed',
          sources: [
            {
              reference: options.reference,
              ...(options.documentId ? { document_id: options.documentId } : {}),
              ...(page ? { page: Number(page) } : {}),
            },
          ],
          notes: [
            'AI-extracted source evidence requires owner verification.',
            options.aiNote,
            legacyFlag
              ? `Extracted legacy flag (${legacyFlag}) has unknown printed/derived origin.`
              : undefined,
          ]
            .filter(Boolean)
            .join(' '),
        },
      });
      if (
        row.collected_at &&
        row.visit_date &&
        string(row.collected_at)?.slice(0, 10) !== string(row.visit_date)?.slice(0, 10)
      ) {
        fact.provenance.verification = 'conflict';
        fact.provenance.notes += ` Conflicting source collection text: ${String(row.collected_at)} / ${String(row.visit_date)}.`;
      }
      items.push({ item_key: key, action: 'add', fact });
    } catch (error) {
      held.push({
        item_key: key,
        source_row: source,
        issues: [error instanceof Error ? error.message : 'Unsupported extracted result.'],
      });
    }
  });
  if (!rows.length)
    warnings.push(
      'No laboratory rows were extracted. The original is retained; verify the source, retry extraction or enter known facts manually.'
    );
  if (held.length)
    warnings.push(
      `${held.length} source row(s) are held outside the accepted batch. No unsupported row was discarded.`
    );
  return {
    intake: items.length ? intakeSchema.parse({ external_id: options.externalId, items }) : null,
    held,
    warnings,
  };
}
export async function saveTypedLabEvidence(
  actorId: string,
  dependentId: string | null,
  documentId: string,
  raw: unknown,
  reference: string,
  aiNote?: string
) {
  await requireAuthz(actorId, { ownerId: actorId, dependentId }, 'labs', 'write');
  const sqlite = getSqlite();
  const document = sqlite
    .prepare(
      "SELECT * FROM import_batches WHERE id=? AND user_id=? AND dependent_id IS ? AND kind='clinical_labs'"
    )
    .get(documentId, actorId, dependentId) as { id: string; file_hash: string } | undefined;
  if (!document) throw new NotFoundError();
  const adaptation = adaptTypedLabExtraction(raw, {
    externalId: 'typed-lab:' + document.file_hash,
    documentId,
    reference,
    aiNote,
  });
  sqlite
    .transaction(() => {
      const retained = sqlite
        .prepare(
          "SELECT id,payload FROM import_items WHERE batch_id=? AND status!='document_metadata' ORDER BY position"
        )
        .all(documentId) as { id: string; payload: string }[];
      const retainedReport = sqlite
        .prepare(
          "SELECT id FROM import_items WHERE batch_id=? AND status='document_metadata' LIMIT 1"
        )
        .get(documentId);
      if (retained.length || retainedReport) {
        // Recover staging with retained source identities after an interrupted request.
        for (const row of retained) {
          const stored = JSON.parse(row.payload);
          const item = adaptation.intake?.items.find(
            (item) => item.item_key === stored._hf_item_key
          );
          if (item)
            item.fact.provenance.sources[0].reference = `${reference} · clinical-source-item:${row.id}`;
          const held = adaptation.held.find((item) => item.item_key === stored._hf_item_key);
          if (held) held.source_item_id = row.id;
        }
        return;
      }
      const existing = sqlite
        .prepare('SELECT count(*) n FROM import_items WHERE batch_id=?')
        .get(documentId) as { n: number };
      const rows = (raw as Row).results as unknown[];
      rows.forEach((source, index) => {
        const rowId = randomUUID();
        const held = adaptation.held.find((h) => h.item_key === 'result-' + (index + 1));
        if (held) held.source_item_id = rowId;
        const item = adaptation.intake?.items.find(
          (item) => item.item_key === 'result-' + (index + 1)
        );
        if (item)
          item.fact.provenance.sources[0].reference = `${reference} · clinical-source-item:${rowId}`;
        sqlite
          .prepare(
            'INSERT INTO import_items(id,batch_id,position,domain,payload,status,classification)VALUES(?,?,?,?,?,?,?)'
          )
          .run(
            rowId,
            documentId,
            existing.n + index,
            'lab_results',
            JSON.stringify({
              _hf_source_row: source,
              _hf_item_key: 'result-' + (index + 1),
              _hf_issues: held?.issues ?? [],
              _hf_extraction_revision: contentRevision(raw),
            }),
            held ? 'held' : 'source_evidence',
            'source_evidence'
          );
      });
      sqlite
        .prepare(
          'INSERT INTO import_items(id,batch_id,position,domain,payload,status,classification)VALUES(?,?,?,?,?,?,?)'
        )
        .run(
          randomUUID(),
          documentId,
          existing.n + rows.length,
          'lab_results',
          JSON.stringify({ _hf_document_report: raw }),
          'document_metadata',
          'source_evidence'
        );
      sqlite
        .prepare('UPDATE import_batches SET status=?,warnings=?,updated_at=? WHERE id=?')
        .run(
          adaptation.held.length || !adaptation.intake ? 'incomplete' : 'pending_typed_review',
          JSON.stringify(adaptation.warnings),
          new Date().toISOString(),
          documentId
        );
    })
    .immediate();
  const batch = adaptation.intake
    ? await stageClinicalIntake(actorId, { ownerId: actorId, dependentId }, adaptation.intake)
    : null;
  return { batch, held: adaptation.held, warnings: adaptation.warnings };
}
export async function getTypedLabEvidence(actorId: string, documentId: string) {
  const sqlite = getSqlite();
  const document = sqlite
    .prepare("SELECT * FROM import_batches WHERE id=? AND user_id=? AND kind='clinical_labs'")
    .get(documentId, actorId) as
    | {
        id: string;
        dependent_id: string | null;
        file_name: string;
        source_path: string | null;
        status: string;
        warnings: string;
        file_hash: string;
      }
    | undefined;
  if (!document) throw new NotFoundError();
  await requireAuthz(
    actorId,
    { ownerId: actorId, dependentId: document.dependent_id },
    'labs',
    'read'
  );
  const items = sqlite
    .prepare(
      "SELECT id,payload,status,record_id FROM import_items WHERE batch_id=? AND status!='document_metadata' ORDER BY position LIMIT 2000"
    )
    .all(documentId) as { id: string; payload: string; status: string; record_id: string | null }[];
  const total = sqlite
    .prepare("SELECT count(*) n FROM import_items WHERE batch_id=? AND status!='document_metadata'")
    .get(documentId) as { n: number };
  const retained = items.map((item) => {
    const raw = JSON.parse(item.payload);
    return {
      source_item_id: item.id,
      item_key: raw._hf_item_key as string,
      source_row: raw._hf_source_row as unknown,
      issues: raw._hf_issues as string[],
      status: item.status,
      record_id: item.record_id,
    };
  });
  const clinicalBatch = sqlite
    .prepare(
      'SELECT id FROM clinical_intake_batches WHERE user_id=? AND dependent_id IS ? AND external_id=?'
    )
    .get(actorId, document.dependent_id, 'typed-lab:' + document.file_hash) as
    | { id: string }
    | undefined;
  return {
    id: document.id,
    dependent_id: document.dependent_id,
    file_name: document.file_name,
    status: document.status,
    clinical_batch_id: clinicalBatch?.id ?? null,
    original_href: document.source_path
      ? '/api/files/' + document.source_path.split('/').map(encodeURIComponent).join('/')
      : null,
    warnings: JSON.parse(document.warnings) as string[],
    retained,
    total_retained: total.n,
    held: retained.filter((item) => item.status === 'held'),
    coverage:
      'The full original and every extraction row remain retained. This view is capped at 2,000 source rows; held rows require an explicit corrected typed fact and owner approval.',
  };
}
