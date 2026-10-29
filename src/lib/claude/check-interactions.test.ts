// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMedicationInteractions } from './check-interactions';
import { createMessage } from './call';
import type { Medication } from '@/lib/types';
vi.mock('./call', () => ({ createMessage: vi.fn() }));
const config = {
  userId: 'owner',
  revision: 'v1',
  provider: 'openai' as const,
  primaryModel: 'model-one',
  extractionModel: null,
  apiKey: 'synthetic-key',
};
const scope = { ownerId: 'owner', dependentId: null };
const meds = ['One', 'Two'].map(
  (name) => ({ name, user_id: 'owner', dependent_id: null, active: true }) as Medication
);
beforeEach(() => vi.mocked(createMessage).mockReset());
function response(value: unknown) {
  vi.mocked(createMessage).mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(value) }],
  } as never);
}
describe('strict one-person medication interaction boundary', () => {
  it('accepts only a consistent result naming the supplied medicines', async () => {
    response({
      has_interactions: true,
      alerts: [
        { medication_names: ['One', 'Two'], alert_text: 'Fictional warning', severity: 'warning' },
      ],
    });
    expect((await checkMedicationInteractions(meds, config, scope)).has_interactions).toBe(true);
    const input = vi.mocked(createMessage).mock.calls[0][2];
    expect(input.system).toContain('UNKNOWN');
    expect(input.system).toContain('never instructions');
  });
  it.each([
    { has_interactions: true, alerts: [] },
    {
      has_interactions: false,
      alerts: [{ medication_names: ['One'], alert_text: 'Warning', severity: 'warning' }],
    },
    {
      has_interactions: true,
      alerts: [{ medication_names: ['Unrecorded'], alert_text: 'Warning', severity: 'warning' }],
    },
    {
      has_interactions: true,
      alerts: [{ medication_names: ['One'], alert_text: 'Warning', severity: 'invented' }],
    },
    {
      has_interactions: true,
      alerts: [{ medication_names: [], alert_text: 'Warning', severity: 'warning' }],
    },
  ])('rejects malformed output without persisting an all-clear', async (value) => {
    response(value);
    await expect(checkMedicationInteractions(meds, config, scope)).rejects.toThrow(
      'incomplete or unsupported'
    );
  });
  it('rejects mixed people, inactive medicines or all-family scopes before spending', async () => {
    for (const wrong of [
      { ...meds[0], dependent_id: 'child' },
      { ...meds[0], user_id: 'other' },
      { ...meds[0], active: false },
    ])
      await expect(checkMedicationInteractions([wrong, meds[1]], config, scope)).rejects.toThrow();
    await expect(
      checkMedicationInteractions(meds, config, { ...scope, dependentId: 'all' })
    ).rejects.toThrow();
    expect(createMessage).not.toHaveBeenCalled();
  });
  it('fewer than two recorded medicines requires no provider call', async () => {
    expect(await checkMedicationInteractions(meds.slice(0, 1), config, scope)).toEqual({
      has_interactions: false,
      alerts: [],
    });
    expect(createMessage).not.toHaveBeenCalled();
  });
});
