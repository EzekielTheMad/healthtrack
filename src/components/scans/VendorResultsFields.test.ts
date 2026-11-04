import { expect, it } from 'vitest';
import { emptyVendorResults, parseVendorResults } from './VendorResultsFields';
it('keeps unreported vendor numbers absent, zero present and qualitative outputs intact', () => {
  expect(parseVendorResults(emptyVendorResults())).toBeUndefined();
  const value = parseVendorResults({
    scores: [
      {
        key: 'zero',
        name: 'Zero score',
        value: '0',
        low: '0',
        high: '',
        referenceText: 'Source-specific',
      },
    ],
    bodyAge: { value: 'Below reference', unit: 'years', definition: 'Vendor estimate' },
    referenceBands: [{ label: 'Printed band', low: '', high: '0', referenceUnit: 'kg' }],
    recommendations: [{ name: 'Nutrition', text: 'Source advice', value: '', unit: 'kcal' }],
  });
  expect(value?.scores[0]).toMatchObject({
    value: 0,
    reference: { low: 0, high: undefined, text: 'Source-specific' },
  });
  expect(value?.body_age).toMatchObject({
    value: 'Below reference',
    definition: 'Vendor estimate',
  });
  expect(value?.reference_bands[0].reference).toMatchObject({ low: undefined, high: 0 });
  expect(value?.recommendations[0].value).toBeUndefined();
});
it('requires incomplete rows to be resolved and refuses invalid numeric references', () => {
  for (const draft of [
    { ...emptyVendorResults(), scores: [{ key: 'score', name: 'Score', value: '' }] },
    { ...emptyVendorResults(), bodyAge: { value: '', unit: 'years' } },
    {
      ...emptyVendorResults(),
      scores: [{ key: 'score', name: 'Score', value: '0', low: 'not numeric' }],
    },
    {
      ...emptyVendorResults(),
      recommendations: [{ name: 'Advice', text: 'Source advice', value: 'Infinity' }],
    },
  ])
    expect(() => parseVendorResults(draft)).toThrow();
});
