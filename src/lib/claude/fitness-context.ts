// ---------------------------------------------------------------------------
// Fitness context for AI prompts (fitness-domain spec §AI integration #1).
//
// Pure module: formats the owner's active goals and a compact recent-training
// block (last 14 days: session counts by type with labels + dates, frequency
// vs goal) for the health-summary and health-query prompt builders. This is a
// summary block, not raw rows — token cost stays modest. Empty inputs format
// to '' so prompts without goals/workouts read exactly like today.
// ---------------------------------------------------------------------------

import { getMetric } from '@/lib/metrics/registry';

/** Structural subset of a goals repo row — GoalRow is assignable to this. */
export interface PromptGoal {
  kind: 'metric' | 'frequency';
  metricKey?: string | null;
  direction?: 'decrease' | 'increase' | 'maintain' | null;
  targetValue?: number | null;
  targetDate?: string | null;
  sessionType?: string | null;
  perWeek?: number | null;
}

/** Structural subset of a workout session row (entries not needed). */
export interface PromptWorkoutSession {
  type: string;
  label: string | null;
  /** ISO timestamp. */
  startedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-07-07T00:00:00Z` → `Jul 7` (UTC, matching aggregate.ts). */
function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function metricGoalLine(goal: PromptGoal): string {
  const metric = goal.metricKey ? getMetric(goal.metricKey) : undefined;
  const label = metric?.label ?? goal.metricKey ?? 'metric';
  const parts: string[] = [`- ${label}: ${goal.direction ?? 'maintain'}`];
  const detail: string[] = [];
  if (goal.targetValue != null) {
    detail.push(`target ${goal.targetValue}${metric?.unit ? ` ${metric.unit}` : ''}`);
  }
  if (goal.targetDate) detail.push(`by ${goal.targetDate}`);
  if (detail.length > 0) parts.push(`(${detail.join(' ')})`);
  return parts.join(' ');
}

function frequencyGoalLine(goal: PromptGoal): string {
  return `- ${goal.sessionType ?? 'training'} sessions: ${goal.perWeek ?? '?'}x/week`;
}

/**
 * `Active goals:` block, one line per goal — metric goals show
 * direction/target, frequency goals show sessions-per-week. Empty → ''.
 */
export function formatGoalsForPrompt(goals: PromptGoal[]): string {
  if (goals.length === 0) return '';
  const lines = goals.map((g) => (g.kind === 'metric' ? metricGoalLine(g) : frequencyGoalLine(g)));
  return `Active goals:\n${lines.join('\n')}`;
}

/**
 * Compact recent-training block over the trailing 14 days:
 *
 *   Recent training (last 14 days, 6 sessions):
 *   - strength: 4 (Upper A — Jul 1, Jul 8; Lower B — Jul 3, Jul 10) | goal 3x/week, last 7 days: 2
 *   - cardio: 2 (Treadmill — Jul 2, Jul 9)
 *
 * Sessions outside the window are ignored; no in-window sessions → ''.
 * Frequency-goal annotations come from the matching active goal, if any.
 */
export function formatRecentTrainingForPrompt(
  sessions: PromptWorkoutSession[],
  goals: PromptGoal[] = [],
  now: Date = new Date(),
): string {
  const t = now.getTime();
  const cut14 = t - 14 * DAY_MS;
  const cut7 = t - 7 * DAY_MS;

  const recent = sessions
    .filter((s) => {
      const st = Date.parse(s.startedAt);
      return !Number.isNaN(st) && st > cut14 && st <= t;
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (recent.length === 0) return '';

  // Group by type, then by label within a type (insertion order = date order).
  const byType = new Map<string, PromptWorkoutSession[]>();
  for (const s of recent) {
    const group = byType.get(s.type);
    if (group) group.push(s);
    else byType.set(s.type, [s]);
  }

  const goalByType = new Map<string, PromptGoal>();
  for (const g of goals) {
    if (g.kind === 'frequency' && g.sessionType) goalByType.set(g.sessionType, g);
  }

  const lines: string[] = [];
  for (const [type, group] of byType) {
    const byLabel = new Map<string, string[]>();
    for (const s of group) {
      const label = s.label ?? 'unlabeled';
      const dates = byLabel.get(label);
      if (dates) dates.push(fmtDay(s.startedAt));
      else byLabel.set(label, [fmtDay(s.startedAt)]);
    }
    const labelBits = Array.from(byLabel, ([label, dates]) => `${label} — ${dates.join(', ')}`);
    let line = `- ${type}: ${group.length} (${labelBits.join('; ')})`;
    const goal = goalByType.get(type);
    if (goal?.perWeek != null) {
      const last7 = group.filter((s) => Date.parse(s.startedAt) > cut7).length;
      line += ` | goal ${goal.perWeek}x/week, last 7 days: ${last7}`;
    }
    lines.push(line);
  }

  return `Recent training (last 14 days, ${recent.length} session${recent.length === 1 ? '' : 's'}):\n${lines.join('\n')}`;
}
