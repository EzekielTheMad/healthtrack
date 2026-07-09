import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, type HealthContext } from './query';

const emptyContext: HealthContext = {
  profile_data: '',
  medications_data: '',
  lab_results_data: '',
  vitals_data: '',
  flagged_data: '',
  conditions_data: '',
  recent_notes: '',
  appointments_data: '',
};

describe('buildSystemPrompt', () => {
  it('presents vitals under the device & vital metrics aggregate header', () => {
    const prompt = buildSystemPrompt({
      ...emptyContext,
      vitals_data:
        'Sleep:\n- Deep Sleep: 104 min (Jul 7) | 7d avg 92 | 30d avg 88 | trend up',
    });
    expect(prompt).toContain('DEVICE & VITAL METRICS (30-day aggregates):');
    expect(prompt).toContain('- Deep Sleep: 104 min (Jul 7) | 7d avg 92 | 30d avg 88 | trend up');
    // Old raw-dump header is retired.
    expect(prompt).not.toContain('RECENT VITALS');
  });

  it('substitutes placeholder text for empty sections', () => {
    const prompt = buildSystemPrompt(emptyContext);
    expect(prompt).toContain('No vitals data available.');
    expect(prompt).toContain('No medication data available.');
    expect(prompt).not.toContain('{vitals_data}');
  });
});
