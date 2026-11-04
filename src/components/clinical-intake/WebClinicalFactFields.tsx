'use client';
import type { ClinicalFact, FidelityRecord } from '@/lib/fidelity/contracts';
import { WEB_CLINICAL_KINDS, type WebClinicalFact } from '@/lib/fidelity/web-clinical-contracts';
export type WebClinicalKind = WebClinicalFact['kind'];
export const isWebClinicalKind = (kind: ClinicalFact['kind']): kind is WebClinicalKind =>
  (WEB_CLINICAL_KINDS as readonly string[]).includes(kind);
export const webClinicalKindLabels: Record<WebClinicalKind, string> = {
  encounter: 'Encounter / office measurements',
  sleep_study: 'Diagnostic sleep study',
  pap_report: 'PAP aggregate report',
  screening: 'Screening / questionnaire',
  condition: 'Condition / clinical history',
  procedure: 'Procedure / order history',
  allergy_review: 'Allergy review',
  genetic_report: 'Genetic report / counseling',
};
type Fields = Record<string, FieldSpec>;
type FieldSpec = { label: string; optional?: boolean; help?: string } & (
  | { type: 'text' }
  | { type: 'number' }
  | { type: 'date' }
  | { type: 'response' }
  | { type: 'record' }
  | { type: 'select'; options: readonly string[] }
  | { type: 'object'; fields: Fields }
  | { type: 'array'; fields: Fields; max: number }
);
type Draft = Record<string, unknown>;
const text = (label: string, optional = true): FieldSpec => ({ type: 'text', label, optional });
const num = (label: string, optional = true): FieldSpec => ({ type: 'number', label, optional });
const date = (label: string, optional = false): FieldSpec => ({ type: 'date', label, optional });
const select = (label: string, options: readonly string[]): FieldSpec => ({
  type: 'select',
  label,
  options,
});
const object = (label: string, fields: Fields, optional = false): FieldSpec => ({
  type: 'object',
  label,
  fields,
  optional,
});
const array = (label: string, fields: Fields, max = 100): FieldSpec => ({
  type: 'array',
  label,
  fields,
  max,
});
const quantity = { value: num('Value', false), unit: text('Unit', false) };
const duration = {
  value: num('Duration', false),
  unit: select('Duration unit', ['s', 'min', 'h']),
};
const codes = array(
  'Codes',
  {
    system: text('Code system', false),
    code: text('Code', false),
    display: text('Printed description'),
  },
  30
);
const statistic: Fields = {
  key: text('Statistic key', false),
  label: text('Printed label', false),
  value: num('Reported numeric value'),
  unit: text('Reported unit'),
  qualitative: text('Reported qualitative value'),
  statistic: select('Statistic', [
    'reported',
    'spot',
    'mean',
    'median',
    'minimum',
    'maximum',
    'total',
    'percentile',
    'unknown',
  ]),
  definition: text('Printed definition'),
  averaging_denominator: object(
    'Averaging denominator',
    {
      label: text('Denominator label', false),
      value: num('Denominator value'),
      unit: text('Denominator unit'),
    },
    true
  ),
};
const statuses = ['ordered', 'planned', 'cancelled', 'deferred', 'completed', 'unknown'] as const;
const response: Fields = {
  key: text('Response key', false),
  label: text('Question / label'),
  value: { type: 'response', label: 'Response' },
};
/** Every source-report field has an ordinary control; schema validation is still authoritative. */
export const webClinicalFields: Record<WebClinicalKind, Fields> = {
  encounter: {
    name: text('Encounter name', false),
    encounter_date: date('Encounter date'),
    signed_date: date('Signed date', true),
    report_date: date('Report date', true),
    encounter_id: text('Encounter identity'),
    provider: text('Provider'),
    location: text('Location'),
    observations: array('Observations', {
      observation_key: text('Observation key', false),
      metric: select('Metric', [
        'heart_rate',
        'height',
        'weight',
        'systolic_bp',
        'diastolic_bp',
        'respiratory_rate',
        'oxygen_saturation',
        'temperature',
        'other',
      ]),
      label: text('Printed observation label'),
      quantity: object('Reported quantity', quantity),
      context: select('Measurement context', [
        'office_spot',
        'home_spot',
        'overnight_aggregate',
        'other',
        'unknown',
      ]),
      observed_at: date('Observation date', true),
      statistic: select('Observation statistic', [
        'spot',
        'mean',
        'median',
        'minimum',
        'maximum',
        'unknown',
      ]),
      definition: text('Observation definition'),
    }),
    notes: text('Encounter notes'),
  },
  sleep_study: {
    name: text('Study name', false),
    study_type: select('Study type', [
      'polysomnography',
      'home_sleep_apnea_test',
      'titration',
      'split_night',
      'other',
      'unknown',
    ]),
    study_date: date('Study date'),
    report_date: date('Report date', true),
    signed_date: date('Signed date', true),
    study_id: text('Study identity'),
    reported_interpretation: text('Reported interpretation'),
    indices: array('Reported indices', statistic, 50),
    oxygen_statistics: array(
      'Oxygen statistics',
      {
        label: text('Oxygen label', false),
        statistic: select('Oxygen statistic', ['minimum', 'mean', 'baseline', 'other', 'unknown']),
        value: num('Oxygen value (%)', false),
        unit: select('Oxygen unit', ['%']),
        definition: text('Oxygen definition'),
      },
      30
    ),
    time_below_thresholds: array(
      'Oxygen threshold durations',
      {
        label: text('Threshold label', false),
        comparator: select('Threshold comparator', ['<', '<=', '>', '>=']),
        threshold_percent: num('Oxygen threshold (%)', false),
        duration: object('Reported duration', duration),
        denominator: text('Duration denominator'),
      },
      30
    ),
    total_recording_time: object('Total recording time', duration, true),
    total_sleep_time: object('Total sleep time', duration, true),
    notes: text('Study notes'),
  },
  pap_report: {
    name: text('PAP report name', false),
    window_start: date('Report window start'),
    window_end: date('Report window end'),
    report_date: date('Report date', true),
    report_id: text('Report identity'),
    therapy: select('Therapy', ['cpap', 'apap', 'bilevel', 'asv', 'other', 'unknown']),
    statistics: array('Reported statistics', statistic),
    adherence: array(
      'Reported adherence',
      {
        label: text('Adherence label', false),
        numerator: num('Adherence numerator'),
        denominator: num('Adherence denominator'),
        count_unit: text('Count unit', false),
        denominator_definition: text('Adherence denominator definition'),
        threshold: object('Adherence threshold', quantity, true),
        threshold_comparator: {
          ...select('Adherence threshold comparator', ['>', '>=', '<', '<=', '=']),
          optional: true,
        },
        reported_percentage: num('Reported percentage'),
      },
      30
    ),
    notes: text('PAP report notes'),
  },
  screening: {
    instrument: object('Instrument', {
      name: text('Instrument name', false),
      version: text('Instrument version'),
    }),
    administration_date: date('Administration date'),
    report_date: date('Report date', true),
    record_type: select('Screening record type', ['administration', 'copied_history', 'unknown']),
    copied_from_record_id: {
      type: 'record',
      label: 'Copied from screening record',
      optional: true,
    },
    reported_total: num('Reported total'),
    score_unit: text('Score unit'),
    item_responses: array('Item responses', response, 200),
    functional_responses: array('Functional responses', response, 50),
    qualitative_result: text('Reported qualitative result'),
    completeness: select('Completeness', ['complete', 'partial', 'unknown']),
    notes: text('Screening notes'),
  },
  condition: {
    name: text('Condition name', false),
    certainty: select('Diagnostic certainty', ['confirmed', 'suspected', 'ruled_out', 'unknown']),
    activity: select('Condition activity', [
      'active',
      'resolved',
      'inactive',
      'remission',
      'unknown',
    ]),
    temporal_scope: select('Temporal scope', [
      'current',
      'historical',
      'family_history',
      'unknown',
    ]),
    onset_date: date('Onset date', true),
    diagnosis_date: date('Diagnosis date', true),
    end_date: date('End date', true),
    report_date: date('Report date', true),
    codes,
    notes: text('Condition notes'),
  },
  procedure: {
    name: text('Procedure name', false),
    status: select('Procedure status', statuses),
    procedure_date: date('Procedure date', true),
    report_date: date('Report date', true),
    events: array('Procedure events', {
      status: select('Event status', statuses),
      event_date: date('Procedure event date'),
      notes: text('Event notes'),
    }),
    codes,
    provider: text('Provider'),
    notes: text('Procedure notes'),
  },
  allergy_review: {
    review_status: select('Allergy review status', [
      'unknown',
      'reviewed_no_known_allergies',
      'allergies_recorded',
    ]),
    review_date: date('Review date'),
    scope: text('Review scope', false),
    reviewed_by: text('Reviewed by'),
    notes: text('Allergy review notes'),
  },
  genetic_report: {
    name: text('Genetic record name', false),
    report_type: select('Genetic record type', [
      'test_result',
      'counseling',
      'family_history',
      'personal_history',
      'unknown',
    ]),
    event_date: date('Event date'),
    report_date: date('Report date', true),
    findings: array('Reported findings', {
      label: text('Finding label', false),
      qualitative_result: text('Qualitative finding', false),
      gene: text('Gene'),
      variant: text('Variant'),
      reported_classification: text('Reported classification'),
    }),
    counseling_summary: text('Counseling summary'),
    notes: text('Genetic record notes'),
  },
};
function defaultValue(spec: FieldSpec): unknown {
  if (spec.optional) return undefined;
  switch (spec.type) {
    case 'array':
      return [];
    case 'object':
      return defaults(spec.fields);
    case 'date':
      return { precision: 'unknown', value: null };
    case 'response':
      return null;
    case 'number':
      return undefined;
    case 'select':
      return spec.options.includes('unknown')
        ? 'unknown'
        : spec.options.length === 1
          ? spec.options[0]
          : '';
    default:
      return '';
  }
}
function defaults(fields: Fields): Draft {
  return Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, defaultValue(spec)]));
}
export function webClinicalDraft(kind: WebClinicalKind, initial?: ClinicalFact): Draft {
  return initial?.kind === kind
    ? (structuredClone(initial) as unknown as Draft)
    : { kind, ...defaults(webClinicalFields[kind]) };
}
/** Optional controls omit absent keys; strict date variants reject keys from another precision. */
export function cleanWebClinicalDraft(value: unknown): unknown {
  if (isResponseDraft(value)) return value._form_response_value;
  if (Array.isArray(value)) return value.map(cleanWebClinicalDraft);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, cleanWebClinicalDraft(v)])
    );
  return value;
}
type ResponseDraft = { _form_response_type: string; _form_response_value: unknown };
function isResponseDraft(value: unknown): value is ResponseDraft {
  return (
    value !== null &&
    typeof value === 'object' &&
    '_form_response_type' in value &&
    '_form_response_value' in value
  );
}
const cls = 'w-full min-w-0 rounded-lg border px-3 py-2';
const style = {
  background: 'var(--bg-primary)',
  color: 'var(--color-text-primary)',
  borderColor: 'var(--border-card)',
};
const human = (value: string) => value.replaceAll('_', ' ');
function DateControl({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  label: string;
}) {
  const d = (value ?? { precision: 'unknown', value: null }) as Draft;
  const precision = String(d.precision);
  return (
    <div className="space-y-3">
      <label className="block text-sm space-y-1">
        <span>{label} precision</span>
        <select
          className={cls}
          style={style}
          value={precision}
          onChange={(e) =>
            onChange({
              ...d,
              precision: e.target.value,
              value: e.target.value === 'unknown' ? null : (d.value ?? ''),
              ...(e.target.value !== 'instant' ? { timezone: undefined } : {}),
            })
          }
        >
          {['unknown', 'year', 'month', 'day', 'instant'].map((p) => (
            <option key={p} value={p}>
              {p === 'instant' ? 'Exact timestamp with offset' : human(p)}
            </option>
          ))}
        </select>
      </label>
      {precision !== 'unknown' && (
        <label className="block text-sm space-y-1">
          <span>{label} value</span>
          <input
            className={cls}
            style={style}
            type={precision === 'day' ? 'date' : precision === 'month' ? 'month' : 'text'}
            value={String(d.value ?? '')}
            required
            placeholder={
              precision === 'instant'
                ? '2026-01-02T10:00:00-07:00'
                : precision === 'year'
                  ? '2026'
                  : undefined
            }
            onChange={(e) => onChange({ ...d, value: e.target.value })}
          />
        </label>
      )}
      {precision === 'instant' && (
        <label className="block text-sm space-y-1">
          <span>{label} timezone (optional)</span>
          <input
            className={cls}
            style={style}
            value={String(d.timezone ?? '')}
            onChange={(e) => onChange({ ...d, timezone: e.target.value || undefined })}
            placeholder="America/Phoenix"
          />
        </label>
      )}
      <label className="block text-sm space-y-1">
        <span>{label} original date text</span>
        <input
          className={cls}
          style={style}
          value={String(d.original_text ?? '')}
          onChange={(e) => onChange({ ...d, original_text: e.target.value || undefined })}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(d.approximate)}
          onChange={(e) => onChange({ ...d, approximate: e.target.checked || undefined })}
        />
        Approximate date
      </label>
    </div>
  );
}
function ResponseControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const type = isResponseDraft(value)
    ? value._form_response_type
    : value == null
      ? 'unknown'
      : typeof value;
  const response = isResponseDraft(value) ? value._form_response_value : value;
  const setResponse = (next: unknown) =>
    onChange({ _form_response_type: type, _form_response_value: next });
  return (
    <div className="space-y-2">
      <label className="block text-sm space-y-1">
        <span>{label} type</span>
        <select
          className={cls}
          style={style}
          value={type}
          onChange={(e) =>
            onChange(
              e.target.value === 'unknown'
                ? null
                : { _form_response_type: e.target.value, _form_response_value: null }
            )
          }
        >
          <option value="unknown">Unknown / not answered</option>
          <option value="string">Text</option>
          <option value="number">Numeric</option>
          <option value="boolean">Yes / no</option>
        </select>
      </label>
      {type === 'boolean' ? (
        <label className="block text-sm space-y-1">
          <span>{label} value</span>
          <select
            className={cls}
            style={style}
            value={response == null ? '' : String(response)}
            onChange={(e) => setResponse(e.target.value === '' ? null : e.target.value === 'true')}
          >
            <option value="">Not answered</option>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
      ) : type !== 'unknown' ? (
        <label className="block text-sm space-y-1">
          <span>{label} value</span>
          <input
            className={cls}
            style={style}
            type={type === 'number' ? 'number' : 'text'}
            step="any"
            value={response == null ? '' : String(response)}
            onChange={(e) =>
              setResponse(
                type === 'number'
                  ? e.target.value === ''
                    ? null
                    : Number(e.target.value)
                  : e.target.value
              )
            }
          />
        </label>
      ) : null}
    </div>
  );
}
function FieldControl({
  spec,
  value,
  onChange,
  records,
}: {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  records: FidelityRecord[];
}) {
  if ((spec.type === 'date' || spec.type === 'object') && spec.optional && value == null)
    return (
      <button
        type="button"
        className="text-sm underline min-h-10 text-left"
        onClick={() => onChange(defaultValue({ ...spec, optional: false }))}
      >
        Add {spec.label.toLowerCase()}
      </button>
    );
  if (spec.type === 'object' || spec.type === 'date' || spec.type === 'array')
    return (
      <fieldset
        className="space-y-3 rounded-lg border p-3 min-w-0"
        style={{ borderColor: 'var(--border-card)' }}
      >
        <legend className="px-1 text-sm font-medium">{spec.label}</legend>
        {spec.type === 'date' ? (
          <DateControl label={spec.label} value={value} onChange={onChange} />
        ) : spec.type === 'object' ? (
          <FieldsControl
            fields={spec.fields}
            value={(value ?? {}) as Draft}
            onChange={onChange}
            records={records}
          />
        ) : (
          <>
            {((value ?? []) as Draft[]).map((row, index, rows) => (
              <fieldset
                key={index}
                className="space-y-3 rounded-lg border p-3 min-w-0"
                style={{ borderColor: 'var(--border-card)' }}
              >
                <legend className="px-1 text-sm">
                  {spec.label} {index + 1}
                </legend>
                <FieldsControl
                  fields={spec.fields}
                  value={row}
                  records={records}
                  onChange={(next) => onChange(rows.map((old, i) => (i === index ? next : old)))}
                />
                <button
                  type="button"
                  className="text-sm underline min-h-10"
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                >
                  Remove {spec.label.toLowerCase()} {index + 1}
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              className="text-sm underline min-h-10"
              disabled={((value ?? []) as Draft[]).length >= spec.max}
              onClick={() => onChange([...((value ?? []) as Draft[]), defaults(spec.fields)])}
            >
              Add {spec.label.toLowerCase()}
            </button>
          </>
        )}
        {spec.optional && (
          <button
            type="button"
            className="text-sm underline min-h-10"
            onClick={() => onChange(undefined)}
          >
            Remove {spec.label.toLowerCase()}
          </button>
        )}
      </fieldset>
    );
  if (spec.type === 'response')
    return <ResponseControl label={spec.label} value={value} onChange={onChange} />;
  if (spec.type === 'select' || spec.type === 'record')
    return (
      <label className="block text-sm space-y-1">
        <span>{spec.label}</span>
        <select
          className={cls}
          style={style}
          value={String(value ?? '')}
          required={!spec.optional}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          {spec.optional ? (
            <option value="">Not reported</option>
          ) : spec.type === 'select' &&
            !spec.options.includes('unknown') &&
            spec.options.length > 1 ? (
            <option value="">Select {spec.label.toLowerCase()}</option>
          ) : null}
          {spec.type === 'select' ? (
            spec.options.map((o) => (
              <option key={o} value={o}>
                {human(o)}
              </option>
            ))
          ) : (
            <>
              <option value="">No linked record</option>
              {records
                .filter((r) => r.kind === 'screening')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fact.kind === 'screening' ? r.fact.instrument.name : ''} · {r.id}
                  </option>
                ))}
              {typeof value === 'string' && !records.some((r) => r.id === value) && (
                <option value={value}>Unavailable selected reference: {value}</option>
              )}
            </>
          )}
        </select>
      </label>
    );
  return (
    <label className="block text-sm space-y-1">
      <span>
        {spec.label}
        {spec.optional ? ' (optional)' : ''}
      </span>
      <input
        className={cls}
        style={style}
        type={spec.type === 'number' ? 'number' : 'text'}
        step={spec.type === 'number' ? 'any' : undefined}
        required={!spec.optional}
        value={value == null ? '' : String(value)}
        onChange={(e) =>
          onChange(
            spec.type === 'number'
              ? e.target.value.trim() === ''
                ? undefined
                : Number(e.target.value)
              : e.target.value || (spec.optional ? undefined : '')
          )
        }
      />
    </label>
  );
}
function FieldsControl({
  fields,
  value,
  onChange,
  records,
}: {
  fields: Fields;
  value: Draft;
  onChange: (v: Draft) => void;
  records: FidelityRecord[];
}) {
  return (
    <div className="space-y-4 min-w-0">
      {Object.entries(fields).map(([key, spec]) => (
        <FieldControl
          key={key}
          spec={spec}
          value={value[key]}
          records={records}
          onChange={(v) => onChange({ ...value, [key]: v })}
        />
      ))}
    </div>
  );
}
export default function WebClinicalFactFields({
  kind,
  value,
  onChange,
  records,
}: {
  kind: WebClinicalKind;
  value: Draft;
  onChange: (v: Draft) => void;
  records: FidelityRecord[];
}) {
  const fields =
    kind === 'screening' && value.record_type !== 'copied_history'
      ? Object.fromEntries(
          Object.entries(webClinicalFields[kind]).filter(([key]) => key !== 'copied_from_record_id')
        )
      : webClinicalFields[kind];
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {kind === 'pap_report'
          ? 'Enter the reported window and denominator definitions. These aggregates never create daily therapy rows or sum overlapping windows.'
          : kind === 'screening'
            ? 'Record only reported totals, individual items and functional responses. They remain separate; no score or diagnosis is calculated.'
            : kind === 'encounter'
              ? 'Keep repeated measurements as separate observations with unique keys. Office heart rate is distinct from resting heart rate; historical height does not change your profile.'
              : kind === 'allergy_review'
                ? 'An empty allergy list does not establish a negative review. Choose reviewed no known allergies only when explicitly reported.'
                : 'Record the source wording and uncertainty. Unknown dates and statuses remain unknown.'}
      </p>
      <FieldsControl
        fields={fields}
        value={value}
        records={records}
        onChange={(v) =>
          onChange(
            kind === 'screening' && v.record_type !== 'copied_history'
              ? { ...v, copied_from_record_id: undefined }
              : v
          )
        }
      />
    </div>
  );
}
