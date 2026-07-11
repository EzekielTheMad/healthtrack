// ---------------------------------------------------------------------------
// Effective goal-direction resolution + delta toning.
//
// The spec's goal semantics: an active metric goal OVERRIDES the registry
// `goalDirection` for that metric in all delta/trend coloring, and adds a
// third state — `maintain` — where "holding steady" reads positive and
// movement either way reads as a warning.
//
// Registry-agnostic by design (wave-2 wiring dependency): callers pass the
// registry default and the user's active metric goals as plain values; this
// module never imports the registry or focus.ts.
// ---------------------------------------------------------------------------

/** Registry directions plus the goal-only `maintain` state. */
export type EffectiveGoalDirection = 'higher' | 'lower' | 'maintain';

export type DeltaTone = 'good' | 'bad' | 'neutral';

/** The slice of an active metric-kind goal this resolver needs. */
export interface ActiveMetricGoal {
  metricKey: string;
  /** Goal-row vocabulary (spec: `decrease` | `increase` | `maintain`). */
  direction: 'increase' | 'decrease' | 'maintain';
}

const GOAL_TO_DIRECTION: Record<ActiveMetricGoal['direction'], EffectiveGoalDirection> = {
  increase: 'higher',
  decrease: 'lower',
  maintain: 'maintain',
};

/**
 * Effective direction for a metric: the user's active metric goal wins over
 * the registry default; with neither, undefined (deltas stay neutral).
 * At most one active goal per metricKey is a DB constraint — the first
 * match wins here.
 */
export function resolveGoalDirection(
  metricKey: string,
  registryDefault: 'higher' | 'lower' | undefined,
  activeMetricGoals: readonly ActiveMetricGoal[],
): EffectiveGoalDirection | undefined {
  const goal = activeMetricGoals.find((g) => g.metricKey === metricKey);
  if (goal) return GOAL_TO_DIRECTION[goal.direction];
  return registryDefault;
}

/**
 * Tone a delta against an effective direction.
 *
 * `flatBand` is the exclusive "reads as no change" threshold — pass the
 * display-precision half-step (`0.5 * 10 ** -decimals`) to match the
 * existing vitals delta convention; a zero delta is always in-band.
 *
 * - undefined direction: always neutral.
 * - higher/lower: in-band -> neutral; outside -> good when the delta moves
 *   the goal way, bad otherwise.
 * - maintain: in-band ("holding steady") -> good; outside -> bad either way.
 */
export function deltaTone(
  delta: number,
  direction: EffectiveGoalDirection | undefined,
  flatBand: number,
): DeltaTone {
  if (direction === undefined) return 'neutral';
  const inBand = delta === 0 || Math.abs(delta) < flatBand;
  if (direction === 'maintain') return inBand ? 'good' : 'bad';
  if (inBand) return 'neutral';
  return (delta > 0) === (direction === 'higher') ? 'good' : 'bad';
}
