'use client';
import { useState, type FormEvent } from 'react';
import {
  clinicalFactSchema,
  type ClinicalDate,
  type ClinicalFact,
  type FidelityRecord,
} from '@/lib/fidelity/contracts';
import { clinicalFactTitle } from './ClinicalFactDetails';
import WebClinicalFactFields, {
  isWebClinicalKind,
  webClinicalDraft,
  webClinicalKindLabels,
  cleanWebClinicalDraft,
} from './WebClinicalFactFields';
type Props = {
  initial?: ClinicalFact;
  records: FidelityRecord[];
  busy: boolean;
  onSubmit: (fact: ClinicalFact) => Promise<void>;
  submitLabel?: string;
  correction?: boolean;
  defaultKind?: ClinicalFact['kind'];
};
const fieldStyle = {
  background: 'var(--bg-primary)',
  color: 'var(--color-text-primary)',
  borderColor: 'var(--border-card)',
};
const cls = 'w-full rounded-lg border px-3 py-2 min-w-0';
function Field({
  label,
  name,
  type = 'text',
  value,
  placeholder,
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string | number;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm space-y-1">
      <span>{label}</span>
      <input
        className={cls}
        style={fieldStyle}
        name={name}
        type={type}
        step={type === 'number' ? 'any' : undefined}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}
function DateFields({
  label,
  prefix,
  initial,
}: {
  label: string;
  prefix: string;
  initial?: ClinicalDate;
}) {
  const [precision, setPrecision] = useState<ClinicalDate['precision']>(
    initial?.precision ?? 'unknown'
  );
  return (
    <fieldset
      className="rounded-lg border p-3 space-y-3"
      style={{ borderColor: 'var(--border-card)' }}
    >
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <label className="block text-sm space-y-1">
        <span>{label} precision</span>
        <select
          name={prefix + '_precision'}
          value={precision}
          onChange={(e) => setPrecision(e.target.value as ClinicalDate['precision'])}
          className={cls}
          style={fieldStyle}
        >
          <option value="unknown">Unknown</option>
          <option value="year">Year only</option>
          <option value="month">Month</option>
          <option value="day">Calendar day</option>
          <option value="instant">Exact timestamp with offset</option>
        </select>
      </label>
      {precision !== 'unknown' && (
        <Field
          label={label + ' value'}
          name={prefix + '_value'}
          value={initial?.value ?? ''}
          type={precision === 'day' ? 'date' : precision === 'month' ? 'month' : 'text'}
          placeholder={
            precision === 'instant'
              ? '2026-10-30T09:00:00-07:00'
              : precision === 'year'
                ? '2026'
                : undefined
          }
          required
        />
      )}
      {precision === 'instant' && (
        <Field
          label={label + ' reported timezone (optional)'}
          name={prefix + '_timezone'}
          value={initial?.precision === 'instant' ? initial.timezone : undefined}
          placeholder="America/Phoenix"
        />
      )}
      <Field
        label={label + ' original text (optional)'}
        name={prefix + '_original'}
        value={initial?.original_text ?? ''}
      />
      <label className="flex gap-2 text-sm items-center">
        <input
          type="checkbox"
          name={prefix + '_approximate'}
          defaultChecked={initial?.approximate ?? false}
        />
        Approximate date
      </label>
    </fieldset>
  );
}
function readDate(data: FormData, prefix: string): ClinicalDate {
  const precision = data.get(prefix + '_precision') as ClinicalDate['precision'];
  return {
    precision,
    value: precision === 'unknown' ? null : String(data.get(prefix + '_value') ?? ''),
    ...(data.get(prefix + '_original')
      ? { original_text: String(data.get(prefix + '_original')) }
      : {}),
    ...(data.get(prefix + '_approximate') ? { approximate: true } : {}),
    ...(precision === 'instant' && data.get(prefix + '_timezone')
      ? { timezone: String(data.get(prefix + '_timezone')) }
      : {}),
  } as ClinicalDate;
}
function n(data: FormData, name: string, required = false) {
  const value = String(data.get(name) ?? '').trim();
  if (!value) {
    if (required) throw new Error('Enter ' + name.replaceAll('_', ' ') + '.');
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new Error('Enter a finite number for ' + name.replaceAll('_', ' ') + '.');
  return number;
}
const t = (data: FormData, name: string) => String(data.get(name) ?? '').trim() || undefined;
function q(data: FormData, prefix: string) {
  const value = n(data, prefix + '_value');
  return value === undefined ? undefined : { value, unit: t(data, prefix + '_unit') ?? '' };
}
const quantityFields = (
  prefix: string,
  label: string,
  initial?: { value: number; unit: string }
) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <Field label={label + ' value'} name={prefix + '_value'} type="number" value={initial?.value} />
    <Field label={label + ' unit'} name={prefix + '_unit'} value={initial?.unit} />
  </div>
);
export default function ClinicalFactForm({
  initial,
  records,
  busy,
  onSubmit,
  submitLabel = 'Preview this record',
  correction = false,
  defaultKind = 'lab',
}: Props) {
  const [kind, setKind] = useState<ClinicalFact['kind']>(initial?.kind ?? defaultKind);
  const [webDrafts, setWebDrafts] = useState<Record<string, Record<string, unknown>>>(() =>
    initial && isWebClinicalKind(initial.kind)
      ? { [initial.kind]: webClinicalDraft(initial.kind, initial) }
      : {}
  );
  const [outcomeKind, setOutcomeKind] = useState(
    initial?.kind === 'lab' ? initial.outcome.kind : 'numeric'
  );
  const [event, setEvent] = useState(
    initial?.kind === 'medication_event' ? initial.event : 'administration'
  );
  const [error, setError] = useState<string | null>(null);
  const med = initial?.kind === 'medication' ? initial : null;
  const lab = initial?.kind === 'lab' ? initial : null;
  const dose = initial?.kind === 'medication_event' ? initial : null;
  const [schedule, setSchedule] = useState(
    () => med?.schedule.map((row, i) => ({ id: String(i), row })) ?? []
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      const data = new FormData(e.currentTarget),
        sources = [...(initial?.provenance.sources ?? [])];
      const reference = t(data, 'source_reference');
      if (!reference && (t(data, 'document_id') || t(data, 'source_page')))
        throw new Error('Add a source reference when providing its document ID or page.');
      if (reference)
        sources.push({
          reference,
          ...(t(data, 'document_id') ? { document_id: t(data, 'document_id') } : {}),
          ...(n(data, 'source_page') !== undefined ? { page: n(data, 'source_page') } : {}),
        });
      const provenance = {
        basis: t(data, 'basis') ?? 'patient_reported',
        verification: t(data, 'verification') ?? 'unconfirmed',
        sources,
        notes: t(data, 'provenance_notes'),
      };
      let fact: unknown;
      if (isWebClinicalKind(kind)) {
        fact = cleanWebClinicalDraft({
          ...(webDrafts[kind] ?? webClinicalDraft(kind)),
          provenance,
        });
      } else if (kind === 'lab') {
        const outcome =
          outcomeKind === 'text'
            ? { kind: 'text', text: t(data, 'result_text') ?? '' }
            : outcomeKind === 'canceled'
              ? { kind: 'canceled', reason: t(data, 'cancel_reason') }
              : {
                  kind: outcomeKind,
                  value: n(data, 'result_value', true),
                  comparator: outcomeKind === 'numeric' ? '=' : t(data, 'comparator'),
                };
        fact = {
          ...(lab ?? {}),
          kind,
          test_name: t(data, 'test_name'),
          outcome,
          normalized: ['numeric', 'censored'].includes(outcomeKind) ? lab?.normalized : undefined,
          raw_result: t(data, 'raw_result'),
          source_unit: t(data, 'source_unit') ?? null,
          reference: {
            ...(lab?.reference ?? {}),
            low: n(data, 'reference_low') ?? null,
            high: n(data, 'reference_high') ?? null,
            text: t(data, 'reference_text'),
            low_comparator: t(data, 'reference_low_comparator'),
            high_comparator: t(data, 'reference_high_comparator'),
            unit: t(data, 'reference_unit'),
          },
          printed_flags: (t(data, 'printed_flags') ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          derived_flag: t(data, 'derived_flag'),
          collection_date: readDate(data, 'collection'),
          report_date: readDate(data, 'report'),
          panel_name: t(data, 'panel_name'),
          report_id: t(data, 'report_id'),
          accession_id: t(data, 'accession_id'),
          specimen_id: t(data, 'specimen_id'),
          specimen_type: t(data, 'specimen_type'),
          loinc_code: t(data, 'loinc_code'),
          fasting_status: t(data, 'fasting_status'),
          provenance,
        };
      } else if (kind === 'medication') {
        const numerator = q(data, 'concentration'),
          denominator = q(data, 'per');
        if (Boolean(numerator) !== Boolean(denominator))
          throw new Error('Enter both concentration and its denominator, or leave both blank.');
        fact = {
          ...(med ?? {}),
          kind,
          name: t(data, 'name'),
          supplement: data.has('supplement'),
          status: t(data, 'status'),
          product_strength: q(data, 'strength'),
          concentration: numerator && denominator ? { numerator, denominator } : undefined,
          administered_amount: q(data, 'amount'),
          route: t(data, 'route'),
          prn: t(data, 'prn') === 'unknown' ? undefined : t(data, 'prn') === 'yes',
          prescribed_directions: t(data, 'prescribed_directions'),
          patient_reported_use: t(data, 'patient_reported_use'),
          schedule: schedule.map(({ id }) => ({
            ...(t(data, 'schedule_' + id + '_weekday') !== undefined
              ? { weekday: n(data, 'schedule_' + id + '_weekday') }
              : {}),
            time_local: t(data, 'schedule_' + id + '_time'),
            amount: q(data, 'schedule_' + id),
            instructions: t(data, 'schedule_' + id + '_instructions'),
          })),
          start_date: readDate(data, 'start'),
          end_date: readDate(data, 'end'),
          rxcui: t(data, 'rxcui'),
          formulation: t(data, 'formulation'),
          notes: t(data, 'notes'),
          provenance,
        };
      } else
        fact = {
          ...(dose ?? {}),
          kind,
          medication_id: t(data, 'medication_id'),
          event,
          event_date: readDate(data, 'event'),
          amount: event === 'administration' ? q(data, 'event_amount') : undefined,
          notes: t(data, 'notes'),
          provenance,
        };
      await onSubmit(clinicalFactSchema.parse(fact));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not preview this record.');
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="block text-sm space-y-1">
        <span>Record type</span>
        <select
          className={cls}
          style={fieldStyle}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ClinicalFact['kind']);
            setError(null);
          }}
          disabled={correction}
        >
          <option value="lab">Lab result</option>
          <option value="medication">Medication or supplement</option>
          <option value="medication_event">
            Medication administration / missed / skipped event
          </option>
          {Object.entries(webClinicalKindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {isWebClinicalKind(kind) && (
        <WebClinicalFactFields
          kind={kind}
          value={webDrafts[kind] ?? webClinicalDraft(kind)}
          records={records}
          onChange={(value) => setWebDrafts((previous) => ({ ...previous, [kind]: value }))}
        />
      )}
      {kind === 'lab' && (
        <>
          <Field label="Test name" name="test_name" value={lab?.test_name} required />
          <label className="block text-sm space-y-1">
            <span>Outcome type</span>
            <select
              className={cls}
              style={fieldStyle}
              value={outcomeKind}
              onChange={(e) => setOutcomeKind(e.target.value as typeof outcomeKind)}
            >
              <option value="numeric">Exact numeric result</option>
              <option value="censored">Censored / below or above limit</option>
              <option value="text">Text / qualitative result</option>
              <option value="canceled">Canceled test</option>
            </select>
          </label>
          {['numeric', 'censored'].includes(outcomeKind) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {outcomeKind === 'censored' && (
                <label className="block text-sm space-y-1">
                  <span>Printed comparator</span>
                  <select
                    name="comparator"
                    className={cls}
                    style={fieldStyle}
                    defaultValue={lab?.outcome.kind === 'censored' ? lab.outcome.comparator : '<'}
                  >
                    {['<', '<=', '>', '>='].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Field
                label={outcomeKind === 'censored' ? 'Bound value' : 'Result value'}
                name="result_value"
                type="number"
                value={lab && 'value' in lab.outcome ? lab.outcome.value : undefined}
                required
              />
            </div>
          )}
          {outcomeKind === 'text' && (
            <Field
              label="Qualitative result"
              name="result_text"
              value={lab?.outcome.kind === 'text' ? lab.outcome.text : undefined}
              required
            />
          )}
          {outcomeKind === 'canceled' && (
            <Field
              label="Cancellation reason"
              name="cancel_reason"
              value={lab?.outcome.kind === 'canceled' ? (lab.outcome.reason ?? '') : undefined}
            />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="Original printed result text"
              name="raw_result"
              value={lab?.raw_result ?? ''}
            />
            <Field label="Source units" name="source_unit" value={lab?.source_unit ?? ''} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DateFields
              label="Collection date"
              prefix="collection"
              initial={lab?.collection_date}
            />
            <DateFields label="Report date" prefix="report" initial={lab?.report_date} />
          </div>
          <details className="rounded-lg border p-3" style={{ borderColor: 'var(--border-card)' }}>
            <summary className="cursor-pointer font-medium">
              Reference, flags and draw/report identity
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <Field
                label="Reference low"
                name="reference_low"
                type="number"
                value={lab?.reference?.low ?? ''}
              />
              <Field
                label="Reference high"
                name="reference_high"
                type="number"
                value={lab?.reference?.high ?? ''}
              />
              {(['low', 'high'] as const).map((side) => (
                <label key={side} className="block text-sm space-y-1">
                  <span>Reference {side} comparator</span>
                  <select
                    name={'reference_' + side + '_comparator'}
                    className={cls}
                    style={fieldStyle}
                    defaultValue={lab?.reference?.[`${side}_comparator`] ?? ''}
                  >
                    <option value="">Not reported</option>
                    {['=', '<', '<=', '>', '>='].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              ))}
              <Field
                label="Printed reference text"
                name="reference_text"
                value={lab?.reference?.text ?? ''}
                placeholder="Not established"
              />
              <Field
                label="Reference units"
                name="reference_unit"
                value={lab?.reference?.unit ?? ''}
              />
              <Field
                label="Printed flags (comma separated)"
                name="printed_flags"
                value={lab?.printed_flags.join(', ')}
              />
              <label className="block text-sm space-y-1">
                <span>Separately derived interpretation</span>
                <select
                  name="derived_flag"
                  className={cls}
                  style={fieldStyle}
                  defaultValue={lab?.derived_flag ?? ''}
                >
                  <option value="">Not calculated</option>
                  {['high', 'low', 'within_range', 'unknown'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <Field label="Panel name" name="panel_name" value={lab?.panel_name ?? ''} />
              <Field label="Report identity" name="report_id" value={lab?.report_id ?? ''} />
              <Field
                label="Accession identity"
                name="accession_id"
                value={lab?.accession_id ?? ''}
              />
              <Field label="Specimen identity" name="specimen_id" value={lab?.specimen_id ?? ''} />
              <Field label="Specimen type" name="specimen_type" value={lab?.specimen_type ?? ''} />
              <Field label="Printed LOINC" name="loinc_code" value={lab?.loinc_code ?? ''} />
              <label className="block text-sm space-y-1">
                <span>Known fasting status</span>
                <select
                  name="fasting_status"
                  className={cls}
                  style={fieldStyle}
                  defaultValue={lab?.fasting_status ?? 'unknown'}
                >
                  <option value="unknown">Unknown</option>
                  <option value="fasted">Fasted</option>
                  <option value="fed">Fed</option>
                </select>
              </label>
            </div>
          </details>
        </>
      )}
      {kind === 'medication' && (
        <>
          <Field label="Medication / supplement name" name="name" value={med?.name} required />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm space-y-1">
              <span>Status</span>
              <select
                name="status"
                className={cls}
                style={fieldStyle}
                defaultValue={med?.status ?? 'unconfirmed'}
              >
                {['active', 'historical', 'discontinued', 'unconfirmed'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex gap-2 items-center text-sm">
              <input name="supplement" type="checkbox" defaultChecked={med?.supplement} />
              Supplement
            </label>
          </div>
          {quantityFields('strength', 'Product strength', med?.product_strength)}
          <details
            className="rounded-lg border p-3"
            style={{ borderColor: 'var(--border-card)' }}
            open={Boolean(med?.concentration)}
          >
            <summary className="cursor-pointer font-medium">Product concentration</summary>
            <div className="space-y-3 mt-3">
              {quantityFields(
                'concentration',
                'Concentration numerator',
                med?.concentration?.numerator
              )}
              {quantityFields('per', 'Per denominator', med?.concentration?.denominator)}
            </div>
          </details>
          {quantityFields('amount', 'Administered amount', med?.administered_amount)}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Route" name="route" value={med?.route ?? ''} />
            <label className="block text-sm space-y-1">
              <span>As needed (PRN)</span>
              <select
                name="prn"
                className={cls}
                style={fieldStyle}
                defaultValue={med?.prn === undefined ? 'unknown' : med.prn ? 'yes' : 'no'}
              >
                <option value="unknown">Not reported</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>
          <label className="block text-sm space-y-1">
            <span>Prescribed directions</span>
            <textarea
              className={cls}
              style={fieldStyle}
              name="prescribed_directions"
              defaultValue={med?.prescribed_directions ?? ''}
              rows={3}
            />
          </label>
          <label className="block text-sm space-y-1">
            <span>Patient-reported actual use</span>
            <textarea
              className={cls}
              style={fieldStyle}
              name="patient_reported_use"
              defaultValue={med?.patient_reported_use ?? ''}
              rows={3}
            />
          </label>
          <fieldset className="space-y-3">
            <legend className="font-medium text-sm">Variable schedule (optional)</legend>
            {schedule.map(({ id, row }, index) => (
              <div
                className="rounded-lg border p-3 space-y-3"
                style={{ borderColor: 'var(--border-card)' }}
                key={id}
              >
                <p className="text-sm font-medium">Schedule line {index + 1}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm space-y-1">
                    <span>Weekday</span>
                    <select
                      className={cls}
                      style={fieldStyle}
                      name={'schedule_' + id + '_weekday'}
                      defaultValue={row.weekday ?? ''}
                    >
                      <option value="">Not specified</option>
                      {[
                        'Sunday',
                        'Monday',
                        'Tuesday',
                        'Wednesday',
                        'Thursday',
                        'Friday',
                        'Saturday',
                      ].map((day, i) => (
                        <option value={i} key={day}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="Local time (optional)"
                    name={'schedule_' + id + '_time'}
                    type="time"
                    value={row.time_local}
                  />
                </div>
                {quantityFields('schedule_' + id, 'Schedule amount', row.amount)}
                <Field
                  label="Schedule instructions"
                  name={'schedule_' + id + '_instructions'}
                  value={row.instructions ?? ''}
                />
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => setSchedule((previous) => previous.filter((s) => s.id !== id))}
                >
                  Remove schedule line {index + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-sm underline"
              disabled={schedule.length >= 28}
              onClick={() =>
                setSchedule((previous) => [...previous, { id: crypto.randomUUID(), row: {} }])
              }
            >
              Add schedule line
            </button>
          </fieldset>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DateFields label="Start date" prefix="start" initial={med?.start_date} />
            <DateFields label="End date" prefix="end" initial={med?.end_date} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Formulation" name="formulation" value={med?.formulation ?? ''} />
            <Field label="RxNorm identifier" name="rxcui" value={med?.rxcui ?? ''} />
          </div>
          <Field label="Medication notes" name="notes" value={med?.notes ?? ''} />
        </>
      )}
      {kind === 'medication_event' && (
        <>
          <label className="block text-sm space-y-1">
            <span>Medication for this event</span>
            <select
              name="medication_id"
              className={cls}
              style={fieldStyle}
              defaultValue={dose?.medication_id ?? ''}
              required
            >
              <option value="">Select an existing medication</option>
              {records
                .filter((r) => r.kind === 'medication')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {clinicalFactTitle(r.fact)} · {r.id.slice(-6)}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm space-y-1">
            <span>Explicitly reported event</span>
            <select
              className={cls}
              style={fieldStyle}
              value={event}
              onChange={(e) => setEvent(e.target.value as typeof event)}
            >
              <option value="administration">Administration</option>
              <option value="missed">Reported missed dose</option>
              <option value="intentional_skip">Intentional skip</option>
            </select>
          </label>
          <DateFields label="Event date" prefix="event" initial={dose?.event_date} />
          {event === 'administration' &&
            quantityFields('event_amount', 'Event administered amount', dose?.amount)}
          <Field label="Event notes" name="notes" value={dose?.notes ?? ''} />
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Only record events you know about. An absent event is never treated as a missed dose.
          </p>
        </>
      )}
      <fieldset
        className="rounded-lg border p-3 space-y-3"
        style={{ borderColor: 'var(--border-card)' }}
      >
        <legend className="font-medium text-sm px-1">Evidence and provenance</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm space-y-1">
            <span>Evidence basis</span>
            <select
              name="basis"
              className={cls}
              style={fieldStyle}
              defaultValue={initial?.provenance.basis ?? 'patient_reported'}
            >
              {['source_reported', 'patient_reported', 'derived', 'legacy_unknown'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm space-y-1">
            <span>Verification</span>
            <select
              name="verification"
              className={cls}
              style={fieldStyle}
              defaultValue={initial?.provenance.verification ?? 'unconfirmed'}
            >
              {['unconfirmed', 'source_verified', 'conflict'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        {Boolean(initial?.provenance.sources.length) && (
          <p className="text-xs">
            The {initial!.provenance.sources.length} existing source reference(s) will be retained.
          </p>
        )}
        <Field
          label="Add source reference (optional)"
          name="source_reference"
          placeholder="Report title, patient report, or durable reference"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Existing source document ID (optional)" name="document_id" />
          <Field label="Source page (optional)" name="source_page" type="number" />
        </div>
        <Field
          label="Evidence notes"
          name="provenance_notes"
          value={initial?.provenance.notes ?? ''}
        />
      </fieldset>
      {error && (
        <p
          role="alert"
          className="rounded-lg p-3 break-words text-sm"
          style={{ background: 'var(--bg-primary)', color: 'var(--color-terracotta)' }}
        >
          {error}
        </p>
      )}
      <button
        className="rounded-lg px-4 py-2 font-medium disabled:opacity-50"
        style={{ background: 'var(--color-terracotta)', color: 'white' }}
        type="submit"
        disabled={busy}
      >
        {busy ? 'Preparing preview…' : submitLabel}
      </button>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Previewing makes no accepted clinical change. Review the exact batch before approving it.
      </p>
    </form>
  );
}
