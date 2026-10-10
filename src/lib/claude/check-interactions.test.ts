// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMedicationInteractions, type InteractionProfileScope } from './check-interactions';
import type { Medication } from '@/lib/types';
const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }));
vi.mock('./call', () => ({ createMessage }));
const scope = { ownerId: 'synthetic-owner', dependentId: null };
function med(name: string, dependentId: string | null = null): Medication {
  return {
    id: `synthetic-${name}`,
    user_id: scope.ownerId,
    dependent_id: dependentId,
    name,
    active: true,
    dosage: null,
    frequency: null,
    category: null,
    prescriber_id: null,
    start_date: null,
    end_date: null,
    notes: null,
    created_at: '2026-10-10',
    updated_at: '2026-10-10',
  };
}
function response(value: unknown) {
  createMessage.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(value) }] });
}
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-test-key');
  createMessage.mockReset();
  response({ has_interactions: false, alerts: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe('interaction model boundary (mocked AI, no clinical validation)', () => {
  it('includes one-profile and unknown-context instructions without sending identifiers', async () => {
    await checkMedicationInteractions([med('A', 'child'), med('B', 'child')], {
      ...scope,
      dependentId: 'child',
    });
    const request = createMessage.mock.calls[0][1];
    expect(request.system).toContain('ONE selected profile');
    expect(request.system).toContain('are UNKNOWN');
    expect(request.system).toContain('A dependent is not necessarily a child');
    expect(request.system).toContain('Do not declare the regimen safe');
    expect(request.messages[0].content).toContain('one dependent (age unknown)');
    expect(JSON.stringify(request)).not.toContain('synthetic-owner');
    expect(request.messages[0].content).toContain('1. A');
    expect(request.messages[0].content).toContain('2. B');
  });
  it('rejects mixed people, wrong owner, inactive rows and missing scope before invoking AI', async () => {
    for (const medications of [
      [med('A'), med('B', 'child')],
      [{ ...med('A'), user_id: 'other' }],
      [{ ...med('A'), active: false }],
    ]) {
      await expect(checkMedicationInteractions(medications, scope)).rejects.toThrow(
        'exact, matching'
      );
    }
    for (const badScope of [
      undefined,
      { ownerId: '', dependentId: null },
      { ...scope, dependentId: 'all' },
      { ownerId: scope.ownerId },
    ]) {
      await expect(
        checkMedicationInteractions([], badScope as InteractionProfileScope)
      ).rejects.toThrow('exact, matching');
    }
    expect(createMessage).not.toHaveBeenCalled();
  });
  it('does not call AI for zero or one medication in a valid scope', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    for (const meds of [[], [med('A')]]) {
      expect(await checkMedicationInteractions(meds, scope)).toEqual({
        has_interactions: false,
        alerts: [],
      });
    }
    expect(createMessage).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { has_interactions: false, alerts: [null] },
    { has_interactions: true, alerts: [] },
    {
      has_interactions: false,
      alerts: [{ medication_names: ['A'], alert_text: 'Concern', severity: 'warning' }],
    },
    {
      has_interactions: true,
      alerts: [
        { medication_names: ['Unlisted medication'], alert_text: 'Concern', severity: 'warning' },
      ],
    },
    {
      has_interactions: true,
      alerts: [{ medication_names: [3], alert_text: 'Concern', severity: 'warning' }],
    },
    {
      has_interactions: true,
      alerts: [{ medication_names: ['A', 'B'], alert_text: ' ', severity: 'warning' }],
    },
    {
      has_interactions: true,
      alerts: [{ medication_names: ['A', 'B'], alert_text: 'Concern', severity: 'made-up' }],
    },
  ])('fails closed rather than filtering invalid output into an all-clear: %j', async (value) => {
    response(value);
    await expect(checkMedicationInteractions([med('A'), med('B')], scope)).rejects.toThrow();
  });
  it('accepts valid exact-name alerts and fenced JSON', async () => {
    const result = {
      has_interactions: true,
      alerts: [{ medication_names: ['A', 'B'], alert_text: 'Synthetic concern', severity: 'info' }],
    };
    createMessage.mockResolvedValue({
      content: [{ type: 'text', text: '```json\n' + JSON.stringify(result) + '\n```' }],
    });
    expect(await checkMedicationInteractions([med('A'), med('B')], scope)).toEqual(result);
  });
});
