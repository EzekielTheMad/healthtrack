import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileStep } from './ProfileStep';
import { apiFetch } from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('profile setup', () => {
  it('sends the displayed measurements and null for prefer not to say', async () => {
    vi.mocked(apiFetch).mockResolvedValue({});
    const onNext = vi.fn();
    render(<ProfileStep onNext={onNext} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Example' } });
    fireEvent.change(screen.getByLabelText('Date of Birth'), { target: { value: '1980-01-01' } });
    fireEvent.change(screen.getByLabelText('Feet'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Inches'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Weight/), { target: { value: '180' } });
    fireEvent.click(screen.getByRole('button', { name: 'Metric' }));
    fireEvent.click(screen.getByRole('button', { name: 'Imperial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls[0][1]!.body as string)).toMatchObject({
      biological_sex: null,
      height_inches: 70,
      weight_lbs: 180,
    });
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
  });

  it('retains the entered profile after a rejected save', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Save unavailable'));
    const onNext = vi.fn();
    render(<ProfileStep onNext={onNext} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Display Name'), { target: { value: 'Example' } });
    fireEvent.change(screen.getByLabelText('Date of Birth'), { target: { value: '1980-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
    expect(screen.getByLabelText('Display Name')).toHaveValue('Example');
    expect(onNext).not.toHaveBeenCalled();
  });
});
