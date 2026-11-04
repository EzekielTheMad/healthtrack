import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ClinicalFactForm from './ClinicalFactForm';
import { clinicalFactSchema, type FidelityRecord } from '@/lib/fidelity/contracts';
import ClinicalFactDetails from './ClinicalFactDetails';
const provenance = {
  basis: 'source_reported',
  verification: 'unconfirmed',
  sources: [{ reference: 'Fictional source', document_id: 'protected-source', page: 2 }],
};
const unknown = { precision: 'unknown', value: null, original_text: 'Date not stated' };
const month = {
  precision: 'month',
  value: '2026-02',
  approximate: true,
  original_text: 'About February',
};
const day = { precision: 'day', value: '2026-02-03' };
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const preview = () => {
  fireEvent.submit(screen.getByRole('button', { name: 'Preview this record' }).closest('form')!);
  const error = screen.queryByRole('alert');
  if (error) throw new Error(error.textContent ?? 'Invalid form');
};
function area(label: string) {
  return within(screen.getByRole('group', { name: label }));
}
it('creates grouped, repeated office heart rates and historical height through ordinary controls', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ClinicalFactForm records={[]} busy={false} onSubmit={save} defaultKind="encounter" />);
  change('Encounter name', 'Fictional office visit');
  change('Encounter date precision', 'day');
  change('Encounter date value', '2026-02-03');
  for (const [key, metric, value, unit] of [
    ['pulse-a', 'heart_rate', '0', 'bpm'],
    ['pulse-b', 'heart_rate', '84', 'bpm'],
    ['height', 'height', '180.5', 'cm'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: 'Add observations' }));
    const index = screen.getAllByLabelText('Observation key').length - 1;
    for (const [label, v] of [
      ['Observation key', key],
      ['Metric', metric],
      ['Value', value],
      ['Unit', unit],
      ['Measurement context', 'office_spot'],
    ])
      fireEvent.change(screen.getAllByLabelText(label)[index], { target: { value: v } });
  }
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const fact = save.mock.calls[0][0];
  expect(fact).toMatchObject({
    kind: 'encounter',
    encounter_date: day,
    observations: [
      {
        observation_key: 'pulse-a',
        metric: 'heart_rate',
        quantity: { value: 0, unit: 'bpm' },
        context: 'office_spot',
      },
      { observation_key: 'pulse-b', quantity: { value: 84, unit: 'bpm' } },
      { observation_key: 'height', metric: 'height', quantity: { value: 180.5, unit: 'cm' } },
    ],
  });
  expect(JSON.stringify(fact)).not.toContain('resting_hr');
});
it('creates study oxygen statistics, thresholds, labelled indices and recording durations', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ClinicalFactForm records={[]} busy={false} onSubmit={save} defaultKind="sleep_study" />);
  change('Study name', 'Fictional study');
  change('Study type', 'split_night');
  fireEvent.click(screen.getByRole('button', { name: 'Add reported indices' }));
  change('Statistic key', 'ahi-3');
  change('Printed label', 'AHI 3%');
  change('Reported numeric value (optional)', '0');
  change('Reported unit (optional)', 'events/h');
  change('Printed definition (optional)', 'Source 3% definition');
  fireEvent.click(screen.getByRole('button', { name: 'Add oxygen statistics' }));
  change('Oxygen label', 'Nadir');
  change('Oxygen statistic', 'minimum');
  change('Oxygen value (%)', '83');
  fireEvent.click(screen.getByRole('button', { name: 'Add oxygen threshold durations' }));
  change('Threshold label', 'Below 88%');
  change('Threshold comparator', '<');
  change('Oxygen threshold (%)', '88');
  change('Duration', '0');
  change('Duration unit', 'min');
  fireEvent.click(screen.getByRole('button', { name: 'Add total recording time' }));
  fireEvent.change(area('Total recording time').getByLabelText('Duration'), {
    target: { value: '7.5' },
  });
  fireEvent.change(area('Total recording time').getByLabelText('Duration unit'), {
    target: { value: 'h' },
  });
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({
    kind: 'sleep_study',
    study_date: { precision: 'unknown', value: null },
    indices: [{ value: 0, definition: 'Source 3% definition' }],
    oxygen_statistics: [{ statistic: 'minimum', value: 83 }],
    time_below_thresholds: [{ duration: { value: 0, unit: 'min' } }],
    total_recording_time: { value: 7.5, unit: 'h' },
  });
});
it('preserves PAP windows, zero adherence and explicitly unknown averaging denominators across corrections', async () => {
  const initial = clinicalFactSchema.parse({
    kind: 'pap_report',
    name: 'PAP source report',
    window_start: month,
    window_end: { precision: 'month', value: '2026-03' },
    report_date: day,
    report_id: 'source-report',
    therapy: 'apap',
    statistics: [
      {
        key: 'leak',
        label: 'Leak 95th',
        value: 0,
        unit: 'L/min',
        statistic: 'percentile',
        definition: '95th percentile',
        averaging_denominator: { label: 'Therapy time', value: null, unit: 'h' },
      },
    ],
    adherence: [
      {
        label: 'At least four hours',
        numerator: 0,
        denominator: null,
        count_unit: 'days',
        denominator_definition: 'Reported eligible days',
        threshold: { value: 4, unit: 'h' },
        threshold_comparator: '>=',
        reported_percentage: 0,
      },
    ],
    provenance,
  });
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <ClinicalFactForm initial={initial} records={[]} busy={false} onSubmit={save} correction />
  );
  expect(screen.getByLabelText('Record type')).toBeDisabled();
  change('Adherence denominator (optional)', '0');
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toEqual({
    ...initial,
    adherence: initial.kind === 'pap_report' ? [{ ...initial.adherence[0], denominator: 0 }] : [],
  });
});
it('keeps screening totals, item answers, functional impact and copied history distinct without scoring', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const original = clinicalFactSchema.parse({
    kind: 'screening',
    instrument: { name: 'Fictional screening', version: 'v1' },
    administration_date: unknown,
    record_type: 'administration',
    provenance,
  });
  const record = { id: 'original-screen', kind: 'screening', fact: original } as FidelityRecord;
  render(
    <ClinicalFactForm records={[record]} busy={false} onSubmit={save} defaultKind="screening" />
  );
  change('Instrument name', 'Fictional screening');
  change('Instrument version (optional)', 'v1');
  change('Screening record type', 'copied_history');
  change('Copied from screening record', record.id);
  change('Reported qualitative result (optional)', 'Source notes; score unavailable');
  change('Completeness', 'partial');
  fireEvent.click(screen.getByRole('button', { name: 'Add item responses' }));
  const item = area('Item responses 1');
  fireEvent.change(item.getByLabelText('Response key'), { target: { value: 'answer-one' } });
  fireEvent.change(item.getByLabelText('Response type'), { target: { value: 'number' } });
  fireEvent.change(item.getByLabelText('Response value'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add functional responses' }));
  const functional = area('Functional responses 1');
  fireEvent.change(functional.getByLabelText('Response key'), { target: { value: 'difficulty' } });
  fireEvent.change(functional.getByLabelText('Response type'), { target: { value: 'string' } });
  fireEvent.change(functional.getByLabelText('Response value'), {
    target: { value: 'Some difficulty' },
  });
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({
    record_type: 'copied_history',
    copied_from_record_id: 'original-screen',
    item_responses: [{ key: 'answer-one', value: 0 }],
    functional_responses: [{ key: 'difficulty', value: 'Some difficulty' }],
    completeness: 'partial',
  });
  expect(save.mock.calls[0][0]).not.toHaveProperty('reported_total');
});
it('creates uncertain historical conditions with separate onset, diagnosis and code systems', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ClinicalFactForm records={[]} busy={false} onSubmit={save} defaultKind="condition" />);
  change('Condition name', 'Fictional history');
  change('Diagnostic certainty', 'suspected');
  change('Condition activity', 'inactive');
  change('Temporal scope', 'family_history');
  fireEvent.click(screen.getByRole('button', { name: 'Add onset date' }));
  change('Onset date precision', 'year');
  change('Onset date value', '2020');
  change('Onset date original date text', 'Around 2020');
  fireEvent.click(screen.getByRole('button', { name: 'Add diagnosis date' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add codes' }));
  change('Code system', 'Source ICD');
  change('Code', 'TEST');
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({
    certainty: 'suspected',
    activity: 'inactive',
    temporal_scope: 'family_history',
    onset_date: { precision: 'year', value: '2020', original_text: 'Around 2020' },
    diagnosis_date: { precision: 'unknown', value: null },
    codes: [{ system: 'Source ICD', code: 'TEST' }],
  });
});
it('keeps ordered/cancelled procedure events distinct from a completed procedure date', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ClinicalFactForm records={[]} busy={false} onSubmit={save} defaultKind="procedure" />);
  change('Procedure name', 'Fictional procedure');
  change('Procedure status', 'deferred');
  for (const status of ['ordered', 'cancelled']) {
    fireEvent.click(screen.getByRole('button', { name: 'Add procedure events' }));
    const i = screen.getAllByLabelText('Event status').length - 1;
    fireEvent.change(screen.getAllByLabelText('Event status')[i], { target: { value: status } });
    fireEvent.change(screen.getAllByLabelText('Procedure event date precision')[i], {
      target: { value: 'month' },
    });
    fireEvent.change(screen.getAllByLabelText('Procedure event date value')[i], {
      target: { value: '2026-02' },
    });
  }
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({
    status: 'deferred',
    events: [{ status: 'ordered' }, { status: 'cancelled' }],
  });
  expect(save.mock.calls[0][0]).not.toHaveProperty('procedure_date');
});
it('requires an explicit negative allergy review and never adds an allergen from that choice', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <ClinicalFactForm records={[]} busy={false} onSubmit={save} defaultKind="allergy_review" />
  );
  expect(screen.getByLabelText('Allergy review status')).toHaveValue('unknown');
  change('Review scope', 'Medication allergies');
  change('Allergy review status', 'reviewed_no_known_allergies');
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toMatchObject({
    kind: 'allergy_review',
    review_status: 'reviewed_no_known_allergies',
    review_date: { precision: 'unknown', value: null },
    scope: 'Medication allergies',
  });
  expect(save.mock.calls[0][0]).not.toHaveProperty('allergens');
});
it('records qualitative genetic counseling without interpreting the finding', async () => {
  const save = vi.fn().mockRejectedValue(new Error('Fictional save failed'));
  render(
    <ClinicalFactForm records={[]} busy={false} onSubmit={save} defaultKind="genetic_report" />
  );
  change('Genetic record name', 'Fictional counseling');
  change('Genetic record type', 'counseling');
  change('Counseling summary (optional)', 'Source counseling text');
  fireEvent.click(screen.getByRole('button', { name: 'Add reported findings' }));
  change('Finding label', 'Source result');
  change('Qualitative finding', 'Uncertain significance');
  change('Gene (optional)', 'TEST');
  change('Variant (optional)', 'As printed');
  change('Reported classification (optional)', 'Source classification');
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(await screen.findByRole('alert')).toHaveTextContent('Fictional save failed');
  expect(screen.getByLabelText('Qualitative finding')).toHaveValue('Uncertain significance');
  expect(save.mock.calls[0][0]).toMatchObject({
    report_type: 'counseling',
    findings: [
      {
        qualitative_result: 'Uncertain significance',
        reported_classification: 'Source classification',
      },
    ],
  });
});
it('displays retained original date wording, source references and zero without report-date substitution', () => {
  const fact = clinicalFactSchema.parse({
    kind: 'screening',
    instrument: { name: 'Fictional scale', version: 'v1' },
    administration_date: unknown,
    report_date: day,
    record_type: 'administration',
    reported_total: 0,
    item_responses: [{ key: 'one', value: false }],
    completeness: 'partial',
    provenance,
  });
  render(<ClinicalFactDetails fact={fact} />);
  expect(screen.getByText('Date not stated (precision unknown)')).toBeInTheDocument();
  expect(screen.getByText('Reported total: 0')).toBeInTheDocument();
  expect(screen.getByText(/Item one \[one\]: false/)).toBeInTheDocument();
  expect(
    screen.getByText(/Source: Fictional source; document: protected-source; page 2/)
  ).toBeInTheDocument();
});
it('keeps unanswered numeric and boolean screening items unknown until a value is entered', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ClinicalFactForm records={[]} busy={false} onSubmit={save} defaultKind="screening" />);
  change('Instrument name', 'Fictional unanswered screening');
  for (const [key, type] of [
    ['numeric-unanswered', 'number'],
    ['boolean-unanswered', 'boolean'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: 'Add item responses' }));
    const index = screen.getAllByLabelText('Response key').length - 1;
    fireEvent.change(screen.getAllByLabelText('Response key')[index], { target: { value: key } });
    fireEvent.change(screen.getAllByLabelText('Response type')[index], { target: { value: type } });
  }
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].item_responses).toEqual([
    { key: 'numeric-unanswered', value: null },
    { key: 'boolean-unanswered', value: null },
  ]);
  expect(save.mock.calls[0][0].reported_total).toBeUndefined();
});
it('retains offset timestamps and timezone metadata, and removes timezone when changing to a date-only value', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const initial = clinicalFactSchema.parse({
    kind: 'allergy_review',
    review_status: 'allergies_recorded',
    review_date: {
      precision: 'instant',
      value: '2026-02-03T23:15:00-07:00',
      timezone: 'America/Phoenix',
      original_text: 'Source timestamp',
    },
    scope: 'Fictional review',
    provenance,
  });
  render(<ClinicalFactForm records={[]} busy={false} onSubmit={save} initial={initial} />);
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].review_date).toEqual(
    initial.kind === 'allergy_review' ? initial.review_date : null
  );
  change('Review date precision', 'day');
  change('Review date value', '2026-02-03');
  preview();
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0].review_date).toEqual({
    precision: 'day',
    value: '2026-02-03',
    original_text: 'Source timestamp',
  });
});
