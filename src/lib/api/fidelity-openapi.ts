import { z } from 'zod';
import {
  clinicalDateSchema,
  clinicalFactSchema,
  intakeSchema,
  scanInputSchema,
  CLINICAL_KINDS,
} from '@/lib/fidelity/contracts';

const schema = (value: z.ZodType) => z.toJSONSchema(value, { io: 'input', unrepresentable: 'any' });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const array = (name: string) => ({ type: 'array', items: ref(name) });
const strings = { type: 'array', items: { type: 'string' } };
export const FIDELITY_FORMAT_PARAMETER = {
  name: 'format',
  in: 'query',
  required: false,
  schema: { type: 'string', enum: ['typed'] },
  description:
    'Opt in to typed outcome/date/provenance and coherent scan coverage. Omit for compatible legacy projection; superseded clinical values are omitted with explicit coverage headers.',
};
const response = (description: string, value: unknown) => ({
  description,
  content: { 'application/json': { schema: value } },
});
const auth = {
  '401': response('Invalid or absent token', ref('Error')),
  '403': response('Required explicit grant/subject access unavailable', ref('Error')),
};
const errors = {
  ...auth,
  '400': response('Typed validation failed; unsupported fields are rejected', ref('Error')),
  '404': response('Record/batch not found in token owner scope', ref('Error')),
  '409': response(
    'Identity replay, stale content/record revision, or unresolved match conflict',
    ref('Error')
  ),
};
export const FIDELITY_SCHEMAS = {
  TypedVital: {
    type: 'object',
    required: [
      'id',
      'metric_key',
      'value',
      'source',
      'recorded_at',
      'date_provenance',
      'metadata',
      'metadata_truncated',
    ],
    properties: {
      id: { type: 'string' },
      metric_key: { type: 'string' },
      value: { type: 'number' },
      unit: { type: ['string', 'null'] },
      source: { type: 'string' },
      recorded_at: { type: 'string' },
      last_received_at: { type: ['string', 'null'] },
      date_provenance: ref('ClinicalDate'),
      metadata: {
        description:
          'JSON metadata bounded to depth3,20keys/items per level,500characters/string and4096serializedcharacters; omitted/truncated is explicit.',
      },
      metadata_truncated: { type: 'boolean' },
    },
  },
  TypedVitalHistory: {
    type: 'object',
    required: ['format', 'legacy', 'scans', 'scan_selection', 'source_preferences', 'coverage'],
    properties: {
      format: { const: 'typed' },
      legacy: array('TypedVital'),
      scans: array('BodyScanRecord'),
      scan_selection: ref('ScanSelection'),
      source_preferences: { type: 'object', additionalProperties: { type: 'string' } },
      coverage: { type: 'object' },
    },
  },
  TypedVitalLatest: {
    type: 'object',
    required: ['format', 'legacy_latest', 'scan_latest', 'source_preferences', 'coverage'],
    properties: {
      format: { const: 'typed' },
      legacy_latest: {
        type: 'object',
        additionalProperties: { anyOf: [ref('TypedVital'), { type: 'null' }] },
      },
      scan_latest: ref('ScanSelection'),
      source_preferences: { type: 'object', additionalProperties: { type: 'string' } },
      coverage: { type: 'object' },
    },
  },
  ClinicalOutcome: {
    type: 'object',
    required: ['item_key', 'status', 'record_id', 'reason'],
    properties: {
      item_key: { type: 'string' },
      status: { enum: ['created', 'corrected', 'linked', 'skipped', 'unresolved'] },
      record_id: { type: ['string', 'null'] },
      reason: { type: 'string' },
    },
  },
  ClinicalMatch: {
    type: 'object',
    required: ['id', 'revision', 'fact', 'classification'],
    properties: {
      id: { type: 'string' },
      revision: { type: 'string' },
      fact: ref('ClinicalFact'),
      classification: { enum: ['duplicate', 'possible', 'conflict'] },
      legacy: { type: 'boolean' },
      legacy_conflict: { type: 'boolean' },
      current_legacy: ref('ClinicalFact'),
    },
  },
  ClinicalReviewItem: {
    type: 'object',
    required: [
      'item_key',
      'action',
      'fact',
      'matches',
      'matching_count',
      'matching_revision',
      'outcome',
    ],
    properties: {
      item_key: { type: 'string' },
      action: { enum: ['add', 'correct', 'link', 'skip'] },
      fact: ref('ClinicalFact'),
      target_id: { type: 'string' },
      expected_revision: { type: 'string' },
      reason: { type: ['string', 'null'] },
      matches: array('ClinicalMatch'),
      matching_count: {
        type: 'integer',
        description: 'Total matching records in the exact subject; preview displays at most 100.',
      },
      matching_revision: {
        type: 'string',
        description:
          'Fingerprint of all current matching records, including those outside the visible preview.',
      },
      outcome: { anyOf: [ref('ClinicalOutcome'), { type: 'null' }] },
    },
  },
  ClinicalReview: {
    type: 'object',
    required: [
      'id',
      'version',
      'digest',
      'items',
      'counts',
      'coverage',
      'documents',
      'received_at',
    ],
    properties: {
      id: { type: 'string' },
      user_id: { type: 'string' },
      dependent_id: { type: ['string', 'null'] },
      external_id: { type: 'string' },
      version: { type: 'integer' },
      digest: { type: 'string' },
      approved_at: { type: ['string', 'null'] },
      received_at: { type: 'string' },
      items: array('ClinicalReviewItem'),
      counts: { type: 'object', additionalProperties: { type: 'integer' } },
      coverage: strings,
      documents: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'file_name', 'held', 'pending', 'status'],
          properties: {
            id: { type: 'string' },
            file_name: { type: 'string' },
            held: { type: 'integer' },
            pending: { type: 'integer' },
            status: { type: 'string' },
          },
        },
      },
    },
  },
  ClinicalHistory: {
    type: 'object',
    required: ['format', 'records', 'coverage'],
    properties: {
      format: { const: 'typed' },
      records: array('ClinicalRecord'),
      coverage: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          may_be_limited: { type: 'boolean' },
          legacy_receipt: { const: 'unknown' },
          included_kinds: strings,
          unavailable_kinds: strings,
          test_filter: { type: ['string', 'null'] },
          collection_dates: { type: 'string' },
          warning: { type: 'string' },
        },
      },
    },
  },
  ScanMeasurement: {
    type: 'object',
    required: ['metric_key', 'value', 'unit', 'source_value', 'source_unit', 'estimated'],
    properties: {
      metric_key: { type: 'string' },
      value: { type: 'number' },
      unit: { type: ['string', 'null'] },
      source_value: { type: 'number' },
      source_unit: { type: 'string' },
      raw_text: { type: 'string' },
      definition: { type: ['string', 'null'] },
      estimated: { type: 'boolean' },
    },
  },
  BodyScanRecord: {
    type: 'object',
    required: ['id', 'user_id', 'dependent_id', 'scan', 'measurements', 'revision', 'received_at'],
    properties: {
      id: { type: 'string' },
      user_id: { type: 'string' },
      dependent_id: { type: ['string', 'null'] },
      scan: ref('BodyScanInput'),
      measurements: array('ScanMeasurement'),
      derived_measurements: {
        type: 'array',
        readOnly: true,
        description:
          'Compatible same-scan ratios, separate from reported values; never accepted as input.',
        items: {
          type: 'object',
          properties: {
            metric_key: { enum: ['ecw_ratio', 'body_fat_pct', 'body_water_pct'] },
            value: { type: 'number' },
            unit: { enum: ['fraction', '%'] },
            basis: { const: 'derived' },
            formula: { type: 'string' },
            input_metric_keys: strings,
          },
        },
      },
      revision: { type: 'string' },
      received_at: { type: 'string' },
    },
  },
  ScanHistory: {
    type: 'object',
    required: ['format', 'scans', 'coverage'],
    properties: {
      format: { const: 'typed' },
      scans: array('BodyScanRecord'),
      coverage: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          returned: { type: 'integer' },
          history_may_be_truncated: { type: 'boolean' },
          legacy_vitals_included: { const: false },
          order: { type: 'string' },
        },
      },
    },
  },
  ScanWriteOutcome: {
    type: 'object',
    required: ['result', 'scan'],
    properties: { result: { enum: ['created', 'existing'] }, scan: ref('BodyScanRecord') },
  },
  ScanSelection: {
    type: 'object',
    required: ['scan', 'source', 'policy', 'sources', 'warnings', 'candidate_scan_ids'],
    properties: {
      format: { const: 'typed' },
      scan: { anyOf: [ref('BodyScanRecord'), { type: 'null' }] },
      source: { type: ['string', 'null'] },
      policy: { enum: ['explicit_source', 'saved_preference', 'single_source', 'choice_required'] },
      sources: strings,
      warnings: strings,
      candidate_scan_ids: strings,
      coverage: { type: 'object' },
    },
  },
  ClinicalDate: schema(clinicalDateSchema),
  ClinicalFact: schema(clinicalFactSchema),
  ClinicalIntake: schema(intakeSchema),
  BodyScanInput: schema(scanInputSchema),
  ClinicalRecord: {
    type: 'object',
    required: ['id', 'kind', 'fact', 'revision', 'received_at'],
    properties: {
      id: { type: 'string' },
      kind: { enum: CLINICAL_KINDS },
      fact: ref('ClinicalFact'),
      revision: { type: 'string' },
      received_at: {
        type: ['string', 'null'],
        description:
          'Server receipt timestamp; unknown for legacy adapters, never inferred from created_at.',
      },
      legacy: { type: 'boolean' },
      supersedes_legacy: {
        type: 'object',
        properties: {
          table: { enum: ['lab_results', 'medications', 'conditions', 'procedures'] },
          id: { type: 'string' },
          revision: { type: 'string' },
        },
      },
      legacy_conflict: { type: 'boolean' },
    },
  },
};
const kindParameter = {
  in: 'query',
  name: 'kind',
  schema: { enum: CLINICAL_KINDS },
  description: 'Read only the matching clinical domain; its existing read scope is required.',
};
const boundedLimit = {
  in: 'query',
  name: 'limit',
  schema: { type: 'integer', minimum: 1, maximum: 1000 },
  description: 'Bounded history; response coverage identifies truncation.',
};
export const FIDELITY_PATHS = {
  '/api/v1/clinical-intake': {
    get: {
      summary: 'List own staged clinical previews/outcomes',
      description:
        'Explicit write:clinical_intake grant. New report previews additionally require write:clinical_reports and are omitted without it. Token owner/self only. Previews include matching own clinical records even without separate domain read grants. No approval or canonical writes.',
      responses: {
        '200': response('Bounded staged batches/outcomes', {
          type: 'object',
          properties: { batches: array('ClinicalReview'), approval: { type: 'string' } },
        }),
        ...errors,
      },
    },
    post: {
      summary: 'Stage typed clinical facts for owner review',
      description:
        'Requires the explicit write:clinical_intake grant; encounters, studies, PAP reports, screenings, conditions, procedures, allergy reviews and genetic reports additionally require write:clinical_reports. Persisted report batches and correction targets remain protected when incoming fields omit their kind. write:all and device/read-only tokens do not qualify. Self only; input cannot choose another person. Previews disclose matching own clinical facts even without separate domain read grants. This is staging only. The owner must review the exact version/digest in the app and approve it using a browser session. No PAT commit endpoint exists. Replays return durable existing outcomes; changed content at the same external ID conflicts.',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: ref('ClinicalIntake') } },
      },
      responses: {
        '200': response('Existing staged batch or prior durable outcomes', ref('ClinicalReview')),
        '201': response('Validated staged preview; no canonical write', ref('ClinicalReview')),
        ...errors,
      },
    },
  },
  '/api/v1/clinical-intake/{id}': {
    get: {
      summary: 'Read a staged batch and durable per-item outcomes',
      description:
        'Requires explicit write:clinical_intake and write:clinical_reports for new report kinds; token owner/self only. The ID never expands subject access.',
      parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      responses: {
        '200': response(
          'Typed preview, exact approval digest/revision and per-item outcomes',
          ref('ClinicalReview')
        ),
        ...errors,
      },
    },
  },
  '/api/v1/clinical-records': {
    get: {
      summary: 'Read typed clinical facts with precision, provenance and revision',
      description:
        'Use read:all or the existing domain scope: labs, medications (courses/events), vitals (encounters/studies/PAP reports), conditions (conditions/screenings/genetic reports), procedures, or allergies (review records). Only authorized kinds are returned; coverage identifies unavailable kinds rather than implying they are empty. Self only. Qualitative/canceled/censored outcomes remain typed. Selected legacy overlays/conflicts are explicit; source references do not confer original-file access.',
      parameters: [kindParameter, boundedLimit],
      responses: {
        '200': response(
          'Bounded typed clinical records with explicit coverage',
          ref('ClinicalHistory')
        ),
        ...errors,
      },
    },
  },
  '/api/v1/scans': {
    get: {
      summary: 'Read coherent identified body-composition scans',
      description:
        'Requires read:vitals or read:all. Token owner/self only. Source/device/date precision, collection conditions, original values/units and canonical values remain distinct. BIA outputs are estimates; partial/unknown dates are not exact latest timestamps.',
      parameters: [boundedLimit, { in: 'query', name: 'source', schema: { type: 'string' } }],
      responses: {
        '200': response('Bounded coherent scan history', ref('ScanHistory')),
        ...errors,
      },
    },
    post: {
      summary: 'Create an identified body-composition scan',
      description:
        'Requires explicit write:scans; new regional/specialized metrics, definitions and vendor report fields additionally require write:scan_reports, including persisted report fields omitted from an incoming replay. Existing write:all/write:vitals/device tokens do not qualify. Same owner/source/external_id with same content is idempotent; different content conflicts. Different external IDs preserve valid same-day repeat scans. Manual/typed JSON inputs only; vendor PDF/CSV parsing is unsupported. No day-normalized vital upsert or nutrition-target change occurs.',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: ref('BodyScanInput') } },
      },
      responses: {
        '200': response('Idempotent prior scan', ref('ScanWriteOutcome')),
        '201': response('Created scan', ref('ScanWriteOutcome')),
        ...errors,
      },
    },
  },
  '/api/v1/scans/latest': {
    get: {
      summary: 'Select a coherent latest scan with explicit source and date coverage',
      description:
        'Requires read:vitals or read:all. No metric-wise assembly across sessions/devices. Existing explicit preferences are honored. Ambiguous sources/same-day day-only repeats require a choice; partial/unknown dates do not establish an exact latest scan.',
      parameters: [{ in: 'query', name: 'source', schema: { type: 'string' } }],
      responses: {
        '200': response(
          'Coherent source-aware selection or explicit choice-required/coverage state',
          ref('ScanSelection')
        ),
        ...errors,
      },
    },
  },
};
