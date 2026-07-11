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
  fitness_data: '',
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
    expect(prompt).toContain('No active goals or recent training logged.');
    expect(prompt).not.toContain('{vitals_data}');
    expect(prompt).not.toContain('{fitness_data}');
  });

  it('presents goals + recent training under the fitness header (spec §AI #1)', () => {
    const prompt = buildSystemPrompt({
      ...emptyContext,
      fitness_data:
        'Active goals:\n- Weight: decrease (target 175 lbs)\n\nRecent training (last 14 days, 2 sessions):\n- strength: 2 (Upper A — Jul 1, Jul 8)',
    });
    expect(prompt).toContain('GOALS & RECENT TRAINING:');
    expect(prompt).toContain('- Weight: decrease (target 175 lbs)');
    expect(prompt).toContain('- strength: 2 (Upper A — Jul 1, Jul 8)');
  });

  it('instructs the model to date-frame lab-derived findings (spec §AI #2)', () => {
    const prompt = buildSystemPrompt(emptyContext);
    expect(prompt).toContain('date-frame every lab-derived finding');
    expect(prompt).toContain('as of your May 26 draw');
  });
});
