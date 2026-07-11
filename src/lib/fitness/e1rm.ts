// ---------------------------------------------------------------------------
// Strength math over parsed sets: Epley estimated 1RM and tonnage.
//
// Feeds the exercise-trends UI (working-weight chart with e1RM + weekly
// tonnage secondaries). Pure functions over the typed set array — callers
// pick which sets to pass (e.g. one week's sets for weekly tonnage).
// ---------------------------------------------------------------------------

import type { ParsedSet } from './set-parser';

/**
 * Epley estimated one-rep max: `weight * (1 + reps/30)`; a true single
 * (reps <= 1) is just the weight lifted.
 */
export function epleyE1rm(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

/**
 * Best Epley e1RM across a group of sets, or null when none qualify.
 * Warmups and time-only sets are ignored. Per-side sets use the stated
 * per-side weight (NOT doubled) so the estimate trends against the same
 * per-arm loading the machine displays.
 *
 * Note: the best e1RM is not always the heaviest set — a lighter set at
 * higher reps can estimate higher.
 */
export function bestE1rm(sets: ParsedSet[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (s.warmup || s.weight === undefined || s.reps === undefined || s.reps <= 0) {
      continue;
    }
    const e = epleyE1rm(s.weight, s.reps);
    if (best === null || e > best) best = e;
  }
  return best;
}

/**
 * Tonnage (volume load): `sum(weight * reps)` over working sets.
 *
 * Assumptions (documented per spec):
 * - Per-side sets are DOUBLED — `50/arm x12` moves 50 lb with each arm, so
 *   the set contributes 2 * 50 * 12 = 1200 lb of volume.
 * - Warmup sets are EXCLUDED, matching the domain's "working" derivations
 *   (working weight = heaviest non-warmup set); warmups are only logged
 *   sporadically, so including them would put artificial spikes in weekly
 *   tonnage trends.
 * - Time-only sets (and any set missing weight or reps) contribute 0.
 */
export function tonnage(sets: ParsedSet[]): number {
  let total = 0;
  for (const s of sets) {
    if (s.warmup || s.weight === undefined || s.reps === undefined) continue;
    total += s.weight * s.reps * (s.perSide ? 2 : 1);
  }
  return total;
}
