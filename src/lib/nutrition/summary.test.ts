import { describe, expect, it } from 'vitest';
import { summarizeNutrition } from './summary';
describe('nutrition coverage', () => {
  it('averages observed days, keeps zeros, and separates competing packages', () => {
    const day = {
      date: '2026-10-20',
      sourcePackage: 'tracker.a',
      calories: 2000,
      proteinGrams: null,
      carbsGrams: 100,
      fatGrams: 20,
      fiberGrams: null,
    };
    const result = summarizeNutrition([
      day,
      { ...day, date: '2026-10-21', calories: 0, proteinGrams: 0 },
      { ...day, sourcePackage: 'tracker.b', calories: 2500 },
    ]);
    expect(result[0]).toMatchObject({
      daysRecorded: 2,
      caloriesAvg: 1000,
      proteinGramsAvg: 0,
      fiberGramsAvg: null,
      numericSamples: { calories: 2, proteinGrams: 1, fiberGrams: 0 },
    });
    expect(result[1]).toMatchObject({ sourcePackage: 'tracker.b', caloriesAvg: 2500 });
  });
});
