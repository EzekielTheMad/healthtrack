import type { NutritionDailyRow } from '@/lib/repos/nutrition';

/** Average only observed values, separately for every reporting source. */
export function summarizeNutrition(
  rows: readonly Pick<
    NutritionDailyRow,
    | 'date'
    | 'sourcePackage'
    | 'calories'
    | 'proteinGrams'
    | 'carbsGrams'
    | 'fatGrams'
    | 'fiberGrams'
  >[]
) {
  const grouped = Map.groupBy(rows, (row) => row.sourcePackage);
  const fields = ['calories', 'proteinGrams', 'carbsGrams', 'fatGrams', 'fiberGrams'] as const;
  return [...grouped].map(([sourcePackage, items]) => {
    const means = fields.map((field) => {
      const values = items.map((r) => r[field]).filter((v): v is number => v !== null);
      return {
        count: values.length,
        avg: values.length
          ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
          : null,
      };
    });
    return {
      sourcePackage,
      daysRecorded: new Set(items.map((r) => r.date)).size,
      caloriesAvg: means[0].avg,
      proteinGramsAvg: means[1].avg,
      carbsGramsAvg: means[2].avg,
      fatGramsAvg: means[3].avg,
      fiberGramsAvg: means[4].avg,
      numericSamples: {
        calories: means[0].count,
        proteinGrams: means[1].count,
        carbsGrams: means[2].count,
        fatGrams: means[3].count,
        fiberGrams: means[4].count,
      },
    };
  });
}
