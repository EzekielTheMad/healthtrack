import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import ClinicalFactForm from './ClinicalFactForm';
import type { FidelityRecord } from '@/lib/fidelity/contracts';
function submit() {
  fireEvent.submit(screen.getByRole('button', { name: 'Preview this record' }).closest('form')!);
}
it('submits a qualitative lab with partial date and unknown units without inventing zero or a day', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ClinicalFactForm records={[]} busy={false} onSubmit={save} />);
  fireEvent.change(screen.getByLabelText('Test name'), { target: { value: 'Fictional screen' } });
  fireEvent.change(screen.getByLabelText('Outcome type'), { target: { value: 'text' } });
  fireEvent.change(screen.getByLabelText('Qualitative result'), { target: { value: 'Negative' } });
  fireEvent.change(screen.getByLabelText('Collection date precision'), {
    target: { value: 'month' },
  });
  fireEvent.change(screen.getByLabelText('Collection date value'), {
    target: { value: '2026-02' },
  });
  submit();
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({
    kind: 'lab',
    outcome: { kind: 'text', text: 'Negative' },
    collection_date: { precision: 'month', value: '2026-02' },
    source_unit: null,
  });
  expect(save.mock.calls[0][0].outcome).not.toHaveProperty('value');
});
it('retains entered values after a failed save and never maps blank numbers to zero', async () => {
  const save = vi.fn().mockRejectedValue(new Error('Synthetic save failure'));
  render(<ClinicalFactForm records={[]} busy={false} onSubmit={save} />);
  fireEvent.change(screen.getByLabelText('Test name'), { target: { value: 'Draft survives' } });
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter result value');
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Result value'), { target: { value: '0' } });
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic save failure');
  expect(screen.getByLabelText('Test name')).toHaveValue('Draft survives');
  expect(screen.getByLabelText('Result value')).toHaveValue(0);
});
it('keeps product concentration, administered volume, prescription and actual variable schedule separate', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<ClinicalFactForm records={[]} busy={false} onSubmit={save} />);
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'medication' } });
  fireEvent.change(screen.getByLabelText('Medication / supplement name'), {
    target: { value: 'Fictional injection' },
  });
  for (const [label, value] of [
    ['Product strength value', '20'],
    ['Product strength unit', 'mg'],
    ['Concentration numerator value', '20'],
    ['Concentration numerator unit', 'mg'],
    ['Per denominator value', '1'],
    ['Per denominator unit', 'mL'],
    ['Administered amount value', '0.25'],
    ['Administered amount unit', 'mL'],
    ['Prescribed directions', 'Prescribed twice weekly'],
    ['Patient-reported actual use', 'Reported variable amounts'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Add schedule line' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add schedule line' }));
  for (const [i, value] of ['1', '4'].entries())
    fireEvent.change(screen.getAllByLabelText('Weekday')[i], { target: { value } });
  for (const [i, value] of ['0.25', '0.5'].entries()) {
    fireEvent.change(screen.getAllByLabelText('Schedule amount value')[i], { target: { value } });
    fireEvent.change(screen.getAllByLabelText('Schedule amount unit')[i], {
      target: { value: 'mL' },
    });
  }
  submit();
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({
    status: 'unconfirmed',
    product_strength: { value: 20, unit: 'mg' },
    concentration: { numerator: { value: 20, unit: 'mg' }, denominator: { value: 1, unit: 'mL' } },
    administered_amount: { value: 0.25, unit: 'mL' },
    prescribed_directions: 'Prescribed twice weekly',
    patient_reported_use: 'Reported variable amounts',
    schedule: [
      { weekday: 1, amount: { value: 0.25, unit: 'mL' } },
      { weekday: 4, amount: { value: 0.5, unit: 'mL' } },
    ],
  });
});
it('records only explicit missed or intentional-skip events without an administered amount', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const medication = {
    id: 'med-id',
    kind: 'medication',
    fact: {
      kind: 'medication',
      name: 'Fictional course',
      status: 'unconfirmed',
      supplement: false,
      schedule: [],
      provenance: { basis: 'patient_reported', verification: 'unconfirmed', sources: [] },
    },
    user_id: 'owner',
    dependent_id: null,
    revision: 'one',
    received_at: 'now',
    updated_at: 'now',
  } as FidelityRecord;
  render(<ClinicalFactForm records={[medication]} busy={false} onSubmit={save} />);
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'medication_event' } });
  fireEvent.change(screen.getByLabelText('Medication for this event'), {
    target: { value: 'med-id' },
  });
  fireEvent.change(screen.getByLabelText('Explicitly reported event'), {
    target: { value: 'intentional_skip' },
  });
  expect(screen.queryByLabelText('Event administered amount value')).not.toBeInTheDocument();
  submit();
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({
    event: 'intentional_skip',
    medication_id: 'med-id',
    event_date: { precision: 'unknown', value: null },
  });
  expect(JSON.parse(JSON.stringify(save.mock.calls[0][0]))).not.toHaveProperty('amount');
});
