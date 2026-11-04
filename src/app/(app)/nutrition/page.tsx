'use client';

import NutritionView from '@/components/nutrition/NutritionView';
import { useDateRangeContext } from '@/components/shared/DateRangeContext';

// ---------------------------------------------------------------------------
// Nutrition — a first-class health domain, not a Fitness sub-tab.
//
// Food intake is not training: it has its own source of truth (MacroFactor
// through Health Connect), its own canonical table (nutrition_daily) and its
// own daily cadence. Burying it behind /fitness made it findable only by
// people who already knew it was there.
//
// Scope: imported ACTUAL intake only. Logging and dynamic targets stay in
// MacroFactor — HealthTrack does not become a food logger.
// ---------------------------------------------------------------------------

export default function NutritionPage() {
  const { reportingTimeZone, calendarLoading } = useDateRangeContext();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Nutrition
        </h1>
      </div>
      {calendarLoading ? <p role="status">Resolving reporting calendar…</p> : <NutritionView timeZone={reportingTimeZone ?? 'Etc/UTC'} />}
    </div>
  );
}
