import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileForm } from './ProfileForm';
import { apiFetch } from '@/lib/api/client';

vi.mock('@/lib/api/client', async (original) => ({
  ...(await original<typeof import('@/lib/api/client')>()),
  apiFetch: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const profile = {
  id: 'owner',
  display_name: 'Example',
  date_of_birth: '1980-01-01',
  biological_sex: null,
  unit_system: 'imperial',
  height_inches: 70,
  weight_lbs: 180,
};

describe('profile editing', () => {
  it('saves a private sex choice as null and validates the displayed measurements', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(profile).mockResolvedValueOnce(profile);
    render(<ProfileForm />);
    expect(await screen.findByLabelText('Prefer not to say')).toBeChecked();
    fireEvent.change(screen.getByLabelText(/Height/), { target: { value: '72' } });
    fireEvent.change(screen.getByLabelText(/Weight/), { target: { value: '190' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Profile' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const payload = JSON.parse(vi.mocked(apiFetch).mock.calls[1][1]!.body as string);
    expect(payload).toMatchObject({
      biological_sex: null,
      height_inches: 72,
      weight_lbs: 190,
      date_of_birth: '1980-01-01',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Profile saved!');
  });

  it('rejects an out-of-range displayed measurement before sending a save', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(profile);
    render(<ProfileForm />);
    await screen.findByLabelText(/Height/);
    fireEvent.change(screen.getByLabelText(/Height/), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Height must be at most 108 inches');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('does not round stored measurements when saving an unchanged metric profile', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ ...profile, unit_system: 'metric' })
      .mockResolvedValueOnce(profile);
    render(<ProfileForm />);
    expect(await screen.findByLabelText(/Weight/)).toHaveValue(81.6);
    fireEvent.click(screen.getByRole('button', { name: 'Save Profile' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls[1][1]!.body as string)).toMatchObject({
      height_inches: 70,
      weight_lbs: 180,
      unit_system: 'metric',
    });
  });

  it('makes a load failure visible and permits retry without overwriting the profile', async () => {
    vi.mocked(apiFetch)
      .mockRejectedValueOnce(new Error('Profile temporarily unavailable'))
      .mockResolvedValueOnce(profile);
    render(<ProfileForm />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Profile temporarily unavailable');
    expect(screen.queryByRole('button', { name: 'Save Profile' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading profile' }));
    expect(await screen.findByLabelText('Display Name')).toHaveValue('Example');
  });
});
