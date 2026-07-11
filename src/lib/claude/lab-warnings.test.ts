import { describe, it, expect } from 'vitest';
import {
  attachLabProvenance,
  filterDismissedLabHighlights,
  isLabWarningDismissed,
  normalizeLabTestKey,
  type LabTaggedHighlight,
} from './lab-warnings';

const flags = [
  { testName: 'LDL Cholesterol', visitDate: '2026-05-26' },
  { testName: 'Vitamin D', visitDate: '2026-02-10' },
];

describe('normalizeLabTestKey', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeLabTestKey('  LDL   Cholesterol ')).toBe('ldl cholesterol');
  });
});

describe('attachLabProvenance', () => {
  it('attaches the DB draw date for validated test names (case-insensitive)', () => {
    const [h] = attachLabProvenance(
      [{ type: 'attention', text: 'LDL is high.', labTests: ['ldl cholesterol'] }],
      flags,
    );
    expect(h.labTests).toEqual(['LDL Cholesterol']);
    expect(h.labAsOf).toBe('2026-05-26');
  });

  it('uses the newest draw date when a highlight cites multiple tests', () => {
    const [h] = attachLabProvenance(
      [{ type: 'attention', text: 'x', labTests: ['Vitamin D', 'LDL Cholesterol'] }],
      flags,
    );
    expect(h.labAsOf).toBe('2026-05-26');
    expect(h.labTests).toHaveLength(2);
  });

  it('drops hallucinated test names; strips provenance when none validate', () => {
    const [partial, none] = attachLabProvenance(
      [
        { type: 'attention', text: 'x', labTests: ['LDL Cholesterol', 'Unicorn Enzyme'] },
        { type: 'attention', text: 'y', labTests: ['Unicorn Enzyme'] },
      ],
      flags,
    );
    expect(partial.labTests).toEqual(['LDL Cholesterol']);
    expect(none.labTests).toBeUndefined();
    expect(none.labAsOf).toBeUndefined();
  });

  it('ignores non-array/junk labTests and leaves untagged highlights alone', () => {
    const out = attachLabProvenance(
      [
        { type: 'positive', text: 'plain' },
        { type: 'attention', text: 'junk', labTests: 'LDL Cholesterol' as unknown as string[] },
        { type: 'attention', text: 'mixed', labTests: [42, 'LDL Cholesterol'] as unknown as string[] },
      ],
      flags,
    );
    expect(out[0]).toEqual({ type: 'positive', text: 'plain' });
    expect(out[1].labTests).toBeUndefined();
    expect(out[2].labTests).toEqual(['LDL Cholesterol']);
  });

  it('never trusts a model-supplied labAsOf', () => {
    const [h] = attachLabProvenance(
      [
        {
          type: 'attention',
          text: 'x',
          labTests: ['LDL Cholesterol'],
          labAsOf: '2026-07-09', // hallucinated "current" date
        },
      ],
      flags,
    );
    expect(h.labAsOf).toBe('2026-05-26');
  });
});

describe('dismiss-until-new-labs filtering', () => {
  const labHighlight: LabTaggedHighlight = {
    type: 'attention',
    text: 'LDL is high as of your May 26 draw.',
    labTests: ['LDL Cholesterol'],
    labAsOf: '2026-05-26',
  };
  const plainHighlight: LabTaggedHighlight = { type: 'action', text: 'Book a check-up.' };
  const dismissedAtMay = [{ warningKey: 'ldl cholesterol', labVisitDate: '2026-05-26' }];

  it('hides a dismissed warning while the stamp is current', () => {
    expect(isLabWarningDismissed(labHighlight, dismissedAtMay, '2026-05-26')).toBe(true);
    expect(
      filterDismissedLabHighlights([labHighlight, plainHighlight], dismissedAtMay, '2026-05-26'),
    ).toEqual([plainHighlight]);
  });

  it('auto-clears when a newer lab visit exists', () => {
    expect(isLabWarningDismissed(labHighlight, dismissedAtMay, '2026-07-01')).toBe(false);
    expect(
      filterDismissedLabHighlights([labHighlight], dismissedAtMay, '2026-07-01'),
    ).toEqual([labHighlight]);
  });

  it('requires EVERY cited test to be dismissed', () => {
    const multi: LabTaggedHighlight = {
      ...labHighlight,
      labTests: ['LDL Cholesterol', 'Vitamin D'],
    };
    expect(isLabWarningDismissed(multi, dismissedAtMay, '2026-05-26')).toBe(false);
    const both = [
      ...dismissedAtMay,
      { warningKey: 'vitamin d', labVisitDate: '2026-05-26' },
    ];
    expect(isLabWarningDismissed(multi, both, '2026-05-26')).toBe(true);
  });

  it('never hides non-lab highlights and does nothing without lab data', () => {
    expect(isLabWarningDismissed(plainHighlight, dismissedAtMay, '2026-05-26')).toBe(false);
    expect(isLabWarningDismissed(labHighlight, dismissedAtMay, null)).toBe(false);
  });
});
