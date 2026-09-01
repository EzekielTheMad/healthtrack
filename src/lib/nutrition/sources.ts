/**
 * Friendly names for the Android packages that own a nutrition day.
 *
 * The package name is the IDENTITY — it is what approval matches exactly,
 * what `nutrition_daily.source_package` stores and what the API returns. This
 * map is a DISPLAY layer on top of it: "MacroFactor" reads better in a card
 * than `com.sbs.diet`, but nothing is ever keyed on the friendly label, and an
 * unmapped package falls through to the package name rather than to a guess.
 *
 * Client-safe: no database imports, so the nutrition page can use it directly.
 */
const FRIENDLY_LABELS: Record<string, string> = {
  'com.sbs.diet': 'MacroFactor',
  'com.myfitnesspal.android': 'MyFitnessPal',
  'com.fitbit.FitbitMobile': 'Fitbit',
  'se.sjuka.lifesum': 'Lifesum',
  'com.cronometer.android.gold': 'Cronometer',
  'com.yazio.android': 'YAZIO',
};

/** Display name for an exact package, or the package itself when unmapped. */
export function nutritionSourceLabel(sourcePackage: string): string {
  return FRIENDLY_LABELS[sourcePackage] ?? sourcePackage;
}

/** Whether the label differs from the package (so the UI can show both). */
export function hasFriendlyLabel(sourcePackage: string): boolean {
  return sourcePackage in FRIENDLY_LABELS;
}
