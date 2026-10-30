import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AiSettings from './AiSettings';
vi.mock('@/lib/auth/client', () => ({
  useSession: () => ({ data: { user: { id: 'synthetic-owner' } } }),
}));
const fetchMock = vi.fn();
const saved = {
  revision: 'unconfigured',
  provider: null,
  has_key: false,
  primary_model: null,
  extraction_model: null,
  models: [],
  tested_at: null,
  legacy_available: false,
};
const models = [{ id: 'model-one', label: 'One', documents: 'test_required' }];
function ok(value: unknown) {
  return { ok: true, json: async () => value };
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('AI settings user workflow', () => {
  it('requires discover/test/save, clears the submitted key and never stores it in browser storage', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    fetchMock
      .mockResolvedValueOnce(ok(saved))
      .mockResolvedValueOnce(ok({ draft_id: 'draft', models }))
      .mockResolvedValueOnce(ok({ tested_at: 'now' }))
      .mockResolvedValueOnce(
        ok({
          ...saved,
          revision: 'v1',
          provider: 'openai',
          has_key: true,
          primary_model: 'model-one',
          models,
        })
      );
    render(<AiSettings />);
    await screen.findByRole('button', { name: 'Refresh models' });
    await waitFor(() => expect(screen.getByLabelText('Provider')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'synthetic-secret-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await screen.findByText('Models refreshed. Choose models and test this draft before saving.');
    expect(screen.getByLabelText('API key')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Primary model'), { target: { value: 'model-one' } });
    expect(screen.getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection and documents' }));
    await screen.findByText(
      'Synthetic text, PDF and image requests passed. Save to use this selection.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await screen.findByText('AI settings saved. New requests use this selection immediately.');
    const bodies = fetchMock.mock.calls.slice(1).map((c) => JSON.parse(c[1].body));
    expect(bodies.map((b) => b.action)).toEqual(['discover', 'test', 'save']);
    expect(bodies[1].api_key).toBeUndefined();
    expect(bodies[2].api_key).toBeUndefined();
    expect(screen.queryByDisplayValue('synthetic-secret-key')).toBeNull();
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });
  it('preserves selection on failed save and invalidates the test after edits', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(saved))
      .mockResolvedValueOnce(ok({ draft_id: 'draft', models }))
      .mockResolvedValueOnce(ok({ tested_at: 'now' }))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Settings changed. Reload.' }),
      });
    render(<AiSettings />);
    await waitFor(() => expect(screen.getByLabelText('Provider')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'synthetic-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await screen.findByText('Models refreshed. Choose models and test this draft before saving.');
    fireEvent.change(screen.getByLabelText('Primary model'), { target: { value: 'model-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection and documents' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save AI settings' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Primary model')).toHaveValue('model-one');
    fireEvent.change(screen.getByLabelText('Document extraction model (optional)'), {
      target: { value: 'model-one' },
    });
    expect(screen.getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('shows progress on Test and Save and blocks repeated clicks while requests are pending', async () => {
    let finishTest!: (value: unknown) => void;
    let finishSave!: (value: unknown) => void;
    fetchMock
      .mockResolvedValueOnce(ok(saved))
      .mockResolvedValueOnce(ok({ draft_id: 'draft', models }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishTest = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSave = resolve;
          })
      );
    render(<AiSettings />);
    await waitFor(() => expect(screen.getByLabelText('Provider')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'synthetic-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await screen.findByText('Models refreshed. Choose models and test this draft before saving.');
    fireEvent.change(screen.getByLabelText('Primary model'), { target: { value: 'model-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection and documents' }));
    const testing = await screen.findByRole('button', {
      name: 'Testing connection and documents…',
    });
    expect(testing).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Testing connection and documents…');
    fireEvent.click(testing);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      finishTest(ok({ tested_at: 'now' }));
    });
    await screen.findByText(
      'Synthetic text, PDF and image requests passed. Save to use this selection.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    const saving = await screen.findByRole('button', { name: 'Saving AI settings…' });
    expect(saving).toBeDisabled();
    fireEvent.click(saving);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => {
      finishSave(
        ok({
          ...saved,
          revision: 'v1',
          provider: 'openai',
          has_key: true,
          primary_model: 'model-one',
          models,
        })
      );
    });
    await screen.findByText('AI settings saved. New requests use this selection immediately.');
  });
  it('clears the old test success when the selected model changes', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(saved))
      .mockResolvedValueOnce(ok({ draft_id: 'draft', models }))
      .mockResolvedValueOnce(ok({ tested_at: 'now' }));
    render(<AiSettings />);
    await waitFor(() => expect(screen.getByLabelText('Provider')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'synthetic-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await screen.findByText('Models refreshed. Choose models and test this draft before saving.');
    fireEvent.change(screen.getByLabelText('Primary model'), { target: { value: 'model-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection and documents' }));
    const message = 'Synthetic text, PDF and image requests passed. Save to use this selection.';
    await screen.findByText(message);
    fireEvent.change(screen.getByLabelText('Document extraction model (optional)'), {
      target: { value: 'model-one' },
    });
    expect(screen.getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
    expect(screen.queryByText(message)).toBeNull();
  });
  it('late initial settings cannot replace a draft after effect remount', async () => {
    let initial!: (value: unknown) => void;
    let reads = 0;
    fetchMock.mockImplementation((_url, options) => {
      if (options?.method === 'POST') return Promise.resolve(ok({ draft_id: 'draft', models }));
      if (++reads === 1)
        return new Promise((resolve) => {
          initial = resolve;
        });
      return Promise.resolve(ok(saved));
    });
    render(
      <StrictMode>
        <AiSettings />
      </StrictMode>
    );
    await waitFor(() => expect(screen.getByLabelText('Provider')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'synthetic-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await screen.findByText('Models refreshed. Choose models and test this draft before saving.');
    await act(async () => {
      initial(ok(saved));
    });
    expect(screen.getAllByRole('option', { name: 'One (model-one)' })).toHaveLength(2);
  });
});
