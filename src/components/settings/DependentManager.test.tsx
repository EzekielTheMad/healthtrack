import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Dependent } from '@/lib/types';
import DependentManager from './DependentManager';
const fetchMock = vi.fn();
const child: Dependent = {
  id: 'fictional-child',
  parent_user_id: 'fictional-owner',
  name: 'Fictional child',
  date_of_birth: '2010-01-01',
  biological_sex: 'male',
  relationship: 'child',
  transition_age: 18,
  transitioned: false,
  transitioned_to: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('TZ', 'America/Phoenix');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function openAdd() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add Dependent' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fictional child' } });
  fireEvent.change(screen.getByLabelText('Date of Birth'), { target: { value: '2010-01-01' } });
}
function sent(method: string) {
  return fetchMock.mock.calls.find(([, init]) => init?.method === method)?.[1];
}
it('saves the untouched Prefer not to say default as explicit null and displays the original January 1 date after reload', async () => {
  const saved = { ...child, biological_sex: null };
  fetchMock
    .mockResolvedValueOnce(json([]))
    .mockResolvedValueOnce(json(saved, 201))
    .mockImplementation(async () => json([saved]));
  const page = render(<DependentManager />);
  await openAdd();
  expect(screen.getByLabelText('Biological Sex')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Add Dependent' }));
  await screen.findByText('Jan 1, 2010');
  expect(JSON.parse(sent('POST')!.body)).toMatchObject({
    name: child.name,
    date_of_birth: '2010-01-01',
    biological_sex: null,
  });
  expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  page.unmount();
  render(<DependentManager />);
  await screen.findByText('Jan 1, 2010');
  expect(screen.queryByText(/Dec 31, 2009/)).not.toBeInTheDocument();
});
it('editing Male to Prefer not to say sends null and keeps it cleared on reopening', async () => {
  fetchMock
    .mockResolvedValueOnce(json([child]))
    .mockResolvedValueOnce(json({ ...child, biological_sex: null }))
    .mockImplementation(async () => json([{ ...child, biological_sex: null }]));
  render(<DependentManager />);
  fireEvent.click(await screen.findByTitle('Edit'));
  expect(screen.getByLabelText('Biological Sex')).toHaveValue('male');
  fireEvent.change(screen.getByLabelText('Biological Sex'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument());
  expect(JSON.parse(sent('PATCH')!.body)).toMatchObject({
    id: child.id,
    biological_sex: null,
    date_of_birth: '2010-01-01',
  });
  fireEvent.click(screen.getByTitle('Edit'));
  expect(screen.getByLabelText('Biological Sex')).toHaveValue('');
});
it.each(['add', 'edit'])('retains entered %s form values and shows a failed save', async (mode) => {
  fetchMock
    .mockResolvedValueOnce(json(mode === 'edit' ? [child] : []))
    .mockResolvedValueOnce(json({ message: 'Synthetic save rejected' }, 400));
  render(<DependentManager />);
  if (mode === 'edit') fireEvent.click(await screen.findByTitle('Edit'));
  else await openAdd();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsaved fictional name' } });
  fireEvent.change(screen.getByLabelText('Date of Birth'), { target: { value: '2010-02-03' } });
  fireEvent.change(screen.getByLabelText('Biological Sex'), { target: { value: '' } });
  fireEvent.click(
    screen.getByRole('button', { name: mode === 'edit' ? 'Save Changes' : 'Add Dependent' })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic save rejected');
  expect(screen.getByLabelText('Name')).toHaveValue('Unsaved fictional name');
  expect(screen.getByLabelText('Date of Birth')).toHaveValue('2010-02-03');
  expect(screen.getByLabelText('Biological Sex')).toHaveValue('');
  expect(JSON.parse(sent(mode === 'edit' ? 'PATCH' : 'POST')!.body).biological_sex).toBeNull();
});
it('shows biological sex validation beside the field rather than silently blocking submission', async () => {
  fetchMock.mockResolvedValueOnce(json([]));
  render(<DependentManager />);
  await openAdd();
  const select = screen.getByLabelText('Biological Sex');
  const invalid = document.createElement('option');
  invalid.value = 'unsupported';
  invalid.textContent = 'Unsupported value';
  select.appendChild(invalid);
  fireEvent.change(select, { target: { value: 'unsupported' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Dependent' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choose Male, Female, or Prefer not to say.'
  );
  expect(select).toHaveAttribute('aria-invalid', 'true');
  expect(sent('POST')).toBeUndefined();
  expect(screen.getByLabelText('Name')).toHaveValue('Fictional child');
});
