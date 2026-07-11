/**
 * Focus view panel math — verdict thresholds (each band + boundaries), CPAP
 * adherence (unused nights, first-record window start, 90d cap), weight rate
 * from 7d rolling averages, fat-free steady band, panel presence gating,
 * delta tone direction including lower-is-better metrics, and the goal
 * overrides (metric-goal direction/target, frequency-goal week progress).
 */
import { describe, it, expect } from 'vitest';
import {
  apneaVerdict,
  recoveryVerdict,
  bodyVerdict,
  cpapAdherence,
  weightTrend,
  frequencyVerdict,
  buildFocusPanels,
  type FocusGoalContext,
  type FocusVitalRow,
} from './focus';

/** Fixed "now" — all windows in these tests hang off this instant.
    (2026-07-10 is a Friday; its UTC Monday week starts 2026-07-06.) */
const NOW = new Date('2026-07-10T12:00:00Z');

function row(metric_key: string, value: number, day: string): FocusVitalRow {
  return { metric_key, value, recorded_at: `${day}T00:00:00.000Z` };
}

function panel(rows: FocusVitalRow[], id: string, goals?: FocusGoalContext) {
  const found = buildFocusPanels(rows, NOW, goals).find((p) => p.id === id);
  if (!found) throw new Error(`panel ${id} not built`);
  return found;
}

function stat(rows: FocusVitalRow[], panelId: string, key: string, goals?: FocusGoalContext) {
  const s = panel(rows, panelId, goals).stats.find((st) => st.key === key);
  if (!s) throw new Error(`stat ${key} missing from ${panelId}`);
  return s;
}

// ---------------------------------------------------------------------------
// Verdict thresholds
// ---------------------------------------------------------------------------

describe('apneaVerdict', () => {
  it('is Well controlled below 5', () => {
    expect(apneaVerdict(4.9, 30)).toEqual({ label: 'Well controlled', tone: 'success' });
  });
  it('is Partially controlled from 5 to 15 inclusive', () => {
    expect(apneaVerdict(5, 30)).toEqual({ label: 'Partially controlled', tone: 'warning' });
    expect(apneaVerdict(15, 30)).toEqual({ label: 'Partially controlled', tone: 'warning' });
  });
  it('is Needs attention above 15', () => {
    expect(apneaVerdict(15.1, 30)).toEqual({ label: 'Needs attention', tone: 'danger' });
  });
  it('is Not enough data with fewer than 5 used nights or no AHI average', () => {
    expect(apneaVerdict(3, 4)).toEqual({ label: 'Not enough data', tone: 'neutral' });
    expect(apneaVerdict(null, 10)).toEqual({ label: 'Not enough data', tone: 'neutral' });
  });
});

describe('recoveryVerdict', () => {
  it('maps readiness Oura bands with boundaries', () => {
    expect(recoveryVerdict(85, null, null)).toEqual({ label: 'Primed', tone: 'success' });
    expect(recoveryVerdict(84, null, null)).toEqual({ label: 'Ready to train', tone: 'success' });
    expect(recoveryVerdict(70, null, null)).toEqual({ label: 'Ready to train', tone: 'success' });
    expect(recoveryVerdict(69, null, null)).toEqual({ label: 'Take it easier', tone: 'warning' });
    expect(recoveryVerdict(55, null, null)).toEqual({ label: 'Take it easier', tone: 'warning' });
    expect(recoveryVerdict(54, null, null)).toEqual({ label: 'Rest day', tone: 'danger' });
  });

  it('derives from HRV vs 30d norm when readiness is missing (±10% band)', () => {
    expect(recoveryVerdict(null, 55, 50)).toEqual({ label: 'Primed', tone: 'success' }); // +10%
    expect(recoveryVerdict(null, 50, 50)).toEqual({ label: 'Ready to train', tone: 'success' });
    expect(recoveryVerdict(null, 45, 50)).toEqual({ label: 'Take it easier', tone: 'warning' }); // −10%
  });

  it('is Not enough data without readiness or HRV', () => {
    expect(recoveryVerdict(null, null, null)).toEqual({ label: 'Not enough data', tone: 'neutral' });
    expect(recoveryVerdict(null, 50, null)).toEqual({ label: 'Not enough data', tone: 'neutral' });
  });
});

describe('bodyVerdict', () => {
  it('maps the weekly rate bands with boundaries (default: decrease)', () => {
    expect(bodyVerdict(-0.2)).toEqual({ label: 'Trending down', tone: 'success' });
    expect(bodyVerdict(0.2)).toEqual({ label: 'Trending up', tone: 'warning' });
    expect(bodyVerdict(-0.19)).toEqual({ label: 'Holding steady', tone: 'neutral' });
    expect(bodyVerdict(0.19)).toEqual({ label: 'Holding steady', tone: 'neutral' });
  });
  it('is Not enough data without a rate', () => {
    expect(bodyVerdict(null)).toEqual({ label: 'Not enough data', tone: 'neutral' });
  });
  it('mirrors the bands for an increase goal', () => {
    expect(bodyVerdict(0.2, 'increase')).toEqual({ label: 'Trending up', tone: 'success' });
    expect(bodyVerdict(-0.2, 'increase')).toEqual({ label: 'Trending down', tone: 'warning' });
    expect(bodyVerdict(0.1, 'increase')).toEqual({ label: 'Holding steady', tone: 'neutral' });
  });
  it('maintain: in-band steady is the success state, either trend warns', () => {
    expect(bodyVerdict(0, 'maintain')).toEqual({ label: 'Holding steady', tone: 'success' });
    expect(bodyVerdict(0.19, 'maintain')).toEqual({ label: 'Holding steady', tone: 'success' });
    expect(bodyVerdict(0.2, 'maintain')).toEqual({ label: 'Trending up', tone: 'warning' });
    expect(bodyVerdict(-0.2, 'maintain')).toEqual({ label: 'Trending down', tone: 'warning' });
  });
});

describe('frequencyVerdict', () => {
  const session = (type: string, iso: string) => ({ type, startedAt: iso });

  it('is null without active frequency goals', () => {
    expect(frequencyVerdict([], [session('strength', '2026-07-09T17:00:00Z')], NOW, 'UTC')).toBeNull();
  });

  it('counts only this Monday-anchored week and labels per goal in type order', () => {
    const goals = [
      { sessionType: 'cardio', perWeek: 2 },
      { sessionType: 'strength', perWeek: 3 },
    ];
    const sessions = [
      session('strength', '2026-07-06T17:00:00Z'), // Mon this week
      session('strength', '2026-07-08T17:00:00Z'),
      session('cardio', '2026-07-09T17:00:00Z'),
      session('strength', '2026-07-05T17:00:00Z'), // Sunday — prior week
      session('mobility', '2026-07-08T17:00:00Z'), // no goal for this type
    ];
    const v = frequencyVerdict(goals, sessions, NOW, 'UTC');
    expect(v).toEqual({ label: '2/3 lifts · 1/2 cardio this week', tone: 'success' });
  });

  it('buckets sessions into weeks by the given timezone, not UTC', () => {
    // 2026-07-06T02:00Z is Sunday Jul 5 in Phoenix (UTC-7) → prior week there.
    const goals = [{ sessionType: 'strength', perWeek: 2 }];
    const sessions = [session('strength', '2026-07-06T02:00:00Z')];
    expect(frequencyVerdict(goals, sessions, NOW, 'UTC')!.label).toBe(
      '1/2 lifts this week',
    );
    expect(frequencyVerdict(goals, sessions, NOW, 'America/Phoenix')!.label).toBe(
      '0/2 lifts this week',
    );
  });

  it('stays on pace while the remaining sessions fit in the days left (today included)', () => {
    // Friday: 3 days left in the week (Fri, Sat, Sun).
    const goals = [{ sessionType: 'strength', perWeek: 3 }];
    expect(frequencyVerdict(goals, [], NOW, 'UTC')!.tone).toBe('success'); // 3 ≤ 3
  });

  it('warns when the week is mostly elapsed and a goal cannot fit anymore', () => {
    const goals = [{ sessionType: 'strength', perWeek: 5 }];
    const sessions = [session('strength', '2026-07-06T17:00:00Z')];
    // Friday, 1/5 done → 4 remaining > 3 days left → behind.
    expect(frequencyVerdict(goals, sessions, NOW, 'UTC')).toEqual({
      label: '1/5 lifts this week',
      tone: 'warning',
    });
  });

  it('reads success when all goals are already met, even late in the week', () => {
    const sunday = new Date('2026-07-12T12:00:00Z');
    const goals = [{ sessionType: 'cardio', perWeek: 2 }];
    const sessions = [
      session('cardio', '2026-07-07T17:00:00Z'),
      session('cardio', '2026-07-10T17:00:00Z'),
    ];
    expect(frequencyVerdict(goals, sessions, sunday, 'UTC')).toEqual({
      label: '2/2 cardio this week',
      tone: 'success',
    });
  });

  it('ignores sessions with unparseable timestamps', () => {
    const goals = [{ sessionType: 'strength', perWeek: 2 }];
    const v = frequencyVerdict(goals, [session('strength', 'not-a-date')], NOW, 'UTC');
    expect(v!.label).toBe('0/2 lifts this week');
  });
});

// ---------------------------------------------------------------------------
// CPAP adherence
// ---------------------------------------------------------------------------

describe('cpapAdherence', () => {
  it('counts nights since the first cpap record; sub-threshold and missing nights are unused', () => {
    const rows = [
      row('cpap_usage', 7.5, '2026-07-01'), // first record → window start
      row('cpap_usage', 0, '2026-07-02'), // recorded but unused
      row('cpap_usage', 6, '2026-07-03'),
      // 07-04..07-06 missing entirely → unused
      row('cpap_usage', 8, '2026-07-07'),
      row('cpap_usage', 7, '2026-07-08'),
      row('cpap_usage', 0, '2026-07-09'),
      row('cpap_usage', 7.5, '2026-07-10'),
    ];
    const a = cpapAdherence(rows, NOW);
    expect(a).toEqual({
      pct: 50,
      usedNights: 5,
      totalNights: 10, // Jul 1 .. Jul 10 inclusive
      avgHours: 7.2, // (7.5+6+8+7+7.5)/5
      compliant: false, // 50% < 70%
    });
  });

  it('counts a night as used only at 4 or more hours (exactly 4.0 counts)', () => {
    const rows = [
      row('cpap_usage', 4.0, '2026-07-09'), // boundary — counts
      row('cpap_usage', 3.9, '2026-07-10'), // under the compliance threshold
    ];
    const a = cpapAdherence(rows, NOW);
    expect(a?.usedNights).toBe(1);
    expect(a?.totalNights).toBe(2);
    expect(a?.avgHours).toBe(4);
  });

  it('is compliant at exactly 70% of nights and not below', () => {
    // 7 of 10 nights ≥4h since the first record (Jul 1 .. Jul 10).
    const seventy = [
      ...['01', '02', '03', '04', '05', '06', '07'].map((d) =>
        row('cpap_usage', 7, `2026-07-${d}`),
      ),
      row('cpap_usage', 0, '2026-07-10'), // keeps today in the denominator
    ];
    expect(cpapAdherence(seventy, NOW)?.compliant).toBe(true); // 7/10
    const belowSeventy = seventy.slice(1); // first record Jul 2 → 6/9 ≈ 67%
    expect(cpapAdherence(belowSeventy, NOW)?.compliant).toBe(false);
  });

  it('judges compliance against the today-excluded denominator', () => {
    // 3 of 4 nights ≥4h, Jul 6 .. Jul 9 — today (Jul 10) has no record and
    // must not dilute 75% down to 60%.
    const rows = [
      row('cpap_usage', 7, '2026-07-06'),
      row('cpap_usage', 7, '2026-07-07'),
      row('cpap_usage', 0, '2026-07-08'),
      row('cpap_usage', 7, '2026-07-09'),
    ];
    const a = cpapAdherence(rows, NOW);
    expect(a?.totalNights).toBe(4);
    expect(a?.pct).toBe(75);
    expect(a?.compliant).toBe(true);
  });

  it('caps the window at 90 days back even when the first record is older', () => {
    const rows = [
      row('cpap_usage', 8, '2026-01-01'), // outside the 90d cap
      row('cpap_usage', 7, '2026-07-10'),
    ];
    const a = cpapAdherence(rows, NOW);
    expect(a?.totalNights).toBe(90);
    expect(a?.usedNights).toBe(1);
    expect(a?.pct).toBe(1);
  });

  it('ends the denominator at yesterday when tonight has no data yet', () => {
    const rows = [
      row('cpap_usage', 7, '2026-07-08'),
      row('cpap_usage', 7, '2026-07-09'),
      // no record for Jul 10 (today) — tonight hasn't happened yet
    ];
    const a = cpapAdherence(rows, NOW);
    expect(a?.totalNights).toBe(2); // Jul 8 .. Jul 9
    expect(a?.pct).toBe(100);
  });

  it('includes today in the denominator once today has a record', () => {
    const rows = [
      row('cpap_usage', 7, '2026-07-09'),
      row('cpap_usage', 7, '2026-07-10'),
    ];
    const a = cpapAdherence(rows, NOW);
    expect(a?.totalNights).toBe(2); // Jul 9 .. Jul 10
    expect(a?.pct).toBe(100);
  });

  it('returns null without cpap_usage rows', () => {
    expect(cpapAdherence([row('ahi', 3, '2026-07-10')], NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Weight trend
// ---------------------------------------------------------------------------

describe('weightTrend', () => {
  it('computes 7d rolling average and lbs/week rate from UTC day-keyed daily means', () => {
    const rows = [
      // last 7 days (Jul 4–10): daily values 210, 211, 209 → avg 210
      row('weight', 210, '2026-07-04'),
      row('weight', 211, '2026-07-06'),
      row('weight', 209, '2026-07-10'),
      // prior 7 days (Jun 27–Jul 3): 211 each → avg 211
      row('weight', 211, '2026-06-28'),
      row('weight', 211, '2026-07-01'),
      row('weight', 211, '2026-07-03'),
    ];
    const t = weightTrend(rows, NOW);
    expect(t.avg7).toBeCloseTo(210, 5);
    expect(t.ratePerWeek).toBeCloseTo(-1, 5);
  });

  it('averages multiple same-day readings into one daily value', () => {
    const rows = [
      row('weight', 208, '2026-07-10'),
      row('weight', 210, '2026-07-10'),
      row('weight', 211, '2026-07-01'),
    ];
    const t = weightTrend(rows, NOW);
    expect(t.avg7).toBeCloseTo(209, 5); // (208+210)/2, single day
    expect(t.ratePerWeek).toBeCloseTo(-2, 5);
  });

  it('returns a null rate when either weekly window is empty', () => {
    expect(weightTrend([row('weight', 210, '2026-07-10')], NOW).ratePerWeek).toBeNull();
    const old = weightTrend([row('weight', 210, '2026-06-20')], NOW);
    expect(old.avg7).toBeNull();
    expect(old.ratePerWeek).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Panel gating & ordering
// ---------------------------------------------------------------------------

describe('buildFocusPanels gating', () => {
  it('builds no panels from empty input', () => {
    expect(buildFocusPanels([], NOW)).toEqual([]);
  });

  it('gates each panel on its required metrics', () => {
    expect(buildFocusPanels([row('steps', 5000, '2026-07-10')], NOW).map((p) => p.id)).toEqual(['activity']);
    expect(buildFocusPanels([row('weight', 210, '2026-07-10')], NOW).map((p) => p.id)).toEqual(['body']);
    expect(buildFocusPanels([row('ahi', 3, '2026-07-10')], NOW).map((p) => p.id)).toEqual(['apnea']);
    expect(buildFocusPanels([row('cpap_usage', 7, '2026-07-10')], NOW).map((p) => p.id)).toEqual(['apnea']);
    expect(buildFocusPanels([row('readiness_score', 80, '2026-07-10')], NOW).map((p) => p.id)).toEqual(['recovery']);
    expect(buildFocusPanels([row('hrv_rmssd', 50, '2026-07-10')], NOW).map((p) => p.id)).toEqual(['recovery']);
    // Non-gating metrics alone build nothing.
    expect(buildFocusPanels([row('resting_hr', 60, '2026-07-10')], NOW)).toEqual([]);
  });

  it('orders panels apnea, recovery, body, activity', () => {
    const rows = [
      row('steps', 5000, '2026-07-10'),
      row('weight', 210, '2026-07-10'),
      row('readiness_score', 80, '2026-07-10'),
      row('ahi', 3, '2026-07-10'),
    ];
    expect(buildFocusPanels(rows, NOW).map((p) => p.id)).toEqual([
      'apnea',
      'recovery',
      'body',
      'activity',
    ]);
  });

  it('ignores ordinal and registry-unknown metrics', () => {
    const rows = [
      row('mood', 4, '2026-07-10'), // ordinal
      row('resilience', 3, '2026-07-10'), // ordinal
      row('not_a_metric', 1, '2026-07-10'),
    ];
    expect(buildFocusPanels(rows, NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Apnea panel
// ---------------------------------------------------------------------------

describe('apnea panel', () => {
  /** 6 used nights with AHI, one zero-usage night whose AHI must NOT count. */
  function apneaRows(): FocusVitalRow[] {
    return [
      row('cpap_usage', 7, '2026-07-01'),
      row('cpap_usage', 0, '2026-07-02'),
      row('cpap_usage', 7, '2026-07-03'),
      row('cpap_usage', 7, '2026-07-05'),
      row('cpap_usage', 7, '2026-07-07'),
      row('cpap_usage', 7, '2026-07-09'),
      row('cpap_usage', 7, '2026-07-10'),
      row('ahi', 3, '2026-07-01'),
      row('ahi', 20, '2026-07-02'), // night NOT used — excluded from the average
      row('ahi', 4, '2026-07-03'),
      row('ahi', 3, '2026-07-05'),
      row('ahi', 2, '2026-07-07'),
      row('ahi', 4, '2026-07-09'),
      row('ahi', 2, '2026-07-10'),
    ];
  }

  it('averages AHI over used nights only', () => {
    const p = panel(apneaRows(), 'apnea');
    expect(p.verdict).toEqual({ label: 'Well controlled', tone: 'success' }); // avg 3.0
    expect(stat(apneaRows(), 'apnea', 'ahi').value).toBe('3');
    expect(stat(apneaRows(), 'apnea', 'ahi').sub).toBe('goal <5');
    expect(stat(apneaRows(), 'apnea', 'ahi').tone).toBe('good');
  });

  it('treats AHI nights as used when there is no usage data at all', () => {
    const rows = ['01', '02', '03', '05', '07', '09'].map((d) =>
      row('ahi', 10, `2026-07-${d}`),
    );
    const p = panel(rows, 'apnea');
    expect(p.verdict).toEqual({ label: 'Partially controlled', tone: 'warning' });
    expect(p.nights?.filter((n) => n.used)).toHaveLength(6);
  });

  it('reports Not enough data under 5 used nights', () => {
    const rows = [
      row('cpap_usage', 7, '2026-07-08'),
      row('cpap_usage', 7, '2026-07-09'),
      row('cpap_usage', 7, '2026-07-10'),
      row('ahi', 2, '2026-07-10'),
    ];
    expect(panel(rows, 'apnea').verdict).toEqual({ label: 'Not enough data', tone: 'neutral' });
  });

  it('builds a 14-night evidence strip with gray (unused) nights', () => {
    const p = panel(apneaRows(), 'apnea');
    expect(p.nights).toHaveLength(14);
    expect(p.nights![0].dayKey).toBe('2026-06-27');
    expect(p.nights![13].dayKey).toBe('2026-07-10');
    const jul2 = p.nights!.find((n) => n.dayKey === '2026-07-02')!;
    expect(jul2.used).toBe(false);
    expect(jul2.ahi).toBe(20);
    const jun27 = p.nights![0];
    expect(jun27.used).toBe(false);
    expect(jun27.ahi).toBeNull();
  });

  it('shows adherence with the night counts, amber under 70%', () => {
    const s = stat(apneaRows(), 'apnea', 'adherence');
    expect(s.value).toBe('60%'); // 6 used / 10 nights since first record
    expect(s.sub).toBe('6/10 nights ≥4h');
    expect(s.tone).toBe('warn');
  });

  it('tints adherence green at 70% or more compliant nights', () => {
    const rows = [
      ...['03', '04', '05', '06', '07', '08', '09'].map((d) =>
        row('cpap_usage', 7, `2026-07-${d}`),
      ),
      row('ahi', 3, '2026-07-09'),
    ];
    const s = stat(rows, 'apnea', 'adherence');
    expect(s.value).toBe('100%'); // 7/7 nights (today has no record yet)
    expect(s.sub).toBe('7/7 nights ≥4h');
    expect(s.tone).toBe('good');
  });

  it('flags mask-leak nights over 24 L/min with a warning tint', () => {
    const rows = [
      ...apneaRows(),
      row('mask_leak', 30, '2026-07-09'),
      row('mask_leak', 10, '2026-07-08'),
    ];
    const s = stat(rows, 'apnea', 'mask_leak');
    expect(s.value).toBe('1');
    expect(s.sub).toBe('nights over 24 L/min (30d)');
    expect(s.tone).toBe('warn');
  });

  it('shows OK when no mask-leak night exceeds the limit', () => {
    const rows = [...apneaRows(), row('mask_leak', 10, '2026-07-08')];
    const s = stat(rows, 'apnea', 'mask_leak');
    expect(s.value).toBe('OK');
    expect(s.sub).toBe('0 nights over limit');
    expect(s.tone).toBe('good');
  });

  it('lists only chart metrics that have data', () => {
    expect(panel(apneaRows(), 'apnea').chartMetrics).toEqual(['ahi', 'cpap_usage']);
    const withLeak = [...apneaRows(), row('mask_leak', 10, '2026-07-08')];
    expect(panel(withLeak, 'apnea').chartMetrics).toEqual(['ahi', 'cpap_usage', 'mask_leak']);
  });
});

// ---------------------------------------------------------------------------
// Recovery panel
// ---------------------------------------------------------------------------

describe('recovery panel', () => {
  it('uses the latest readiness for the verdict and deltas vs the 30d mean', () => {
    const rows = [
      row('readiness_score', 88, '2026-07-10'),
      row('readiness_score', 80, '2026-07-01'),
    ];
    const p = panel(rows, 'recovery');
    expect(p.verdict).toEqual({ label: 'Primed', tone: 'success' });
    const s = stat(rows, 'recovery', 'readiness_score');
    expect(s.value).toBe('88');
    expect(s.sub).toBe('+4 vs 30d avg'); // mean (88+80)/2 = 84
    expect(s.tone).toBe('good');
  });

  it('falls back to the HRV norm when readiness is missing, with % delta', () => {
    const rows = [
      row('hrv_rmssd', 45, '2026-07-10'),
      row('hrv_rmssd', 55, '2026-07-01'),
    ];
    const p = panel(rows, 'recovery');
    expect(p.verdict).toEqual({ label: 'Take it easier', tone: 'warning' }); // −10% vs mean 50
    const s = stat(rows, 'recovery', 'hrv_rmssd');
    expect(s.sub).toBe('-10% vs 30d avg');
    expect(s.tone).toBe('bad'); // lower HRV is worse
  });

  it('colors resting HR deltas with lower-is-better direction', () => {
    const rows = [
      row('readiness_score', 80, '2026-07-10'),
      row('resting_hr', 55, '2026-07-10'),
      row('resting_hr', 60, '2026-06-30'),
      row('resting_hr', 65, '2026-06-25'),
    ];
    const s = stat(rows, 'recovery', 'resting_hr');
    expect(s.value).toBe('55');
    expect(s.sub).toBe('-5 vs 30d avg'); // mean 60
    expect(s.tone).toBe('good'); // lower RHR is better
  });

  it('shows last-night sleep duration with an hours delta', () => {
    const rows = [
      row('hrv_rmssd', 50, '2026-07-10'),
      row('sleep_duration', 7.5, '2026-07-10'),
      row('sleep_duration', 6.5, '2026-07-02'),
    ];
    const s = stat(rows, 'recovery', 'sleep_duration');
    expect(s.value).toBe('7.5');
    expect(s.sub).toBe('+0.5 vs 30d avg'); // mean 7.0
    expect(s.tone).toBe('good');
  });

  it('marks deltas that round to zero as flat/neutral', () => {
    const rows = [
      row('readiness_score', 80, '2026-07-10'),
      row('readiness_score', 80, '2026-07-01'),
    ];
    const s = stat(rows, 'recovery', 'readiness_score');
    expect(s.sub).toBe('no change vs 30d avg');
    expect(s.tone).toBe('neutral');
  });

  it('day-deduplicates same-day rows in the 30d mean', () => {
    const rows = [
      row('readiness_score', 80, '2026-07-10'),
      row('readiness_score', 60, '2026-07-01'),
      row('readiness_score', 60, '2026-07-01'), // duplicate reading, same day
    ];
    const s = stat(rows, 'recovery', 'readiness_score');
    // Daily means 80 and 60 → 30d mean 70 (not mean of three rows ≈ 66.7).
    expect(s.sub).toBe('+10 vs 30d avg');
  });

  it('excludes the latest HRV reading from its own fallback baseline', () => {
    const rows = [
      row('hrv_rmssd', 54, '2026-07-10'),
      row('hrv_rmssd', 60, '2026-07-05'),
    ];
    // Baseline is 60 (not mean(54, 60) = 57) → 54 is −10% → Take it easier.
    expect(panel(rows, 'recovery').verdict).toEqual({
      label: 'Take it easier',
      tone: 'warning',
    });
  });

  it('is Not enough data when a single HRV reading has no baseline', () => {
    const rows = [row('hrv_rmssd', 50, '2026-07-10')];
    const p = panel(rows, 'recovery');
    expect(p.verdict).toEqual({ label: 'Not enough data', tone: 'neutral' });
    expect(p.caption).toBeNull(); // no HRV-norm caption without a derivation
  });

  it('keeps today-language while the verdict reading is fresh (≤48h)', () => {
    const rows = [
      row('readiness_score', 80, '2026-07-09'),
      row('sleep_duration', 7.5, '2026-07-09'),
    ];
    const p = panel(rows, 'recovery');
    expect(p.title).toBe('Recovery today');
    expect(p.stats.find((s) => s.key === 'sleep_duration')!.label).toBe('Sleep last night');
  });

  it('dates the title and sleep label when the latest reading is older than 48h', () => {
    const rows = [
      row('readiness_score', 80, '2026-07-07'),
      row('sleep_duration', 7.5, '2026-07-06'),
    ];
    const p = panel(rows, 'recovery');
    expect(p.title).toBe('Recovery (Jul 7)');
    expect(p.stats.find((s) => s.key === 'sleep_duration')!.label).toBe('Sleep (Jul 6)');
  });
});

// ---------------------------------------------------------------------------
// Body composition panel
// ---------------------------------------------------------------------------

describe('body panel', () => {
  function bodyRows(): FocusVitalRow[] {
    return [
      row('weight', 210, '2026-07-04'),
      row('weight', 211, '2026-07-06'),
      row('weight', 209, '2026-07-10'),
      row('weight', 211, '2026-06-28'),
      row('weight', 211, '2026-07-01'),
      row('weight', 211, '2026-07-03'),
    ];
  }

  it('verdicts from the weekly rate of the 7d rolling average', () => {
    expect(panel(bodyRows(), 'body').verdict).toEqual({ label: 'Trending down', tone: 'success' });
    const s = stat(bodyRows(), 'body', 'weight');
    expect(s.value).toBe('210');
    expect(s.sub).toBe('-1 lbs/wk');
    expect(s.tone).toBe('good');
  });

  it('shows the latest weight when the 7d window is empty and reports Not enough data', () => {
    const rows = [row('weight', 210, '2026-06-20')];
    expect(panel(rows, 'body').verdict).toEqual({ label: 'Not enough data', tone: 'neutral' });
    const s = stat(rows, 'body', 'weight');
    expect(s.value).toBe('210');
    expect(s.sub).toBeNull();
  });

  it('compares body fat against the previous reading (lower is better)', () => {
    const rows = [
      ...bodyRows(),
      row('body_fat_pct', 25.0, '2026-07-10'),
      row('body_fat_pct', 25.4, '2026-07-05'),
    ];
    const s = stat(rows, 'body', 'body_fat_pct');
    expect(s.value).toBe('25');
    expect(s.sub).toBe('-0.4 vs prior reading');
    expect(s.tone).toBe('good');
  });

  it('holds fat-free mass steady inside the ±0.5 lb band', () => {
    const rows = [
      ...bodyRows(),
      row('fat_free_mass', 150.0, '2026-07-10'),
      row('fat_free_mass', 149.6, '2026-07-05'),
    ];
    const s = stat(rows, 'body', 'fat_free_mass');
    expect(s.sub).toBe('steady');
    expect(s.tone).toBe('neutral');
  });

  it('flags fat-free mass moves beyond the band with direction tones', () => {
    const up = [
      ...bodyRows(),
      row('fat_free_mass', 150.0, '2026-07-10'),
      row('fat_free_mass', 149.0, '2026-07-05'),
    ];
    expect(stat(up, 'body', 'fat_free_mass').sub).toBe('+1 vs prior reading');
    expect(stat(up, 'body', 'fat_free_mass').tone).toBe('good'); // keeping muscle

    const down = [
      ...bodyRows(),
      row('fat_free_mass', 148.0, '2026-07-10'),
      row('fat_free_mass', 149.0, '2026-07-05'),
    ];
    expect(stat(down, 'body', 'fat_free_mass').tone).toBe('bad');
  });
});

// ---------------------------------------------------------------------------
// Goal overrides (metric goals over registry defaults; empty ctx = fallback)
// ---------------------------------------------------------------------------

describe('goal overrides', () => {
  function goalBodyRows(): FocusVitalRow[] {
    return [
      // last 7 days avg 210; prior 7 days avg 211 → rate −1 lbs/wk
      row('weight', 210, '2026-07-04'),
      row('weight', 211, '2026-07-06'),
      row('weight', 209, '2026-07-10'),
      row('weight', 211, '2026-06-28'),
      row('weight', 211, '2026-07-01'),
      row('weight', 211, '2026-07-03'),
    ];
  }

  it('an empty goal context reproduces the no-goals panels exactly', () => {
    const rows = [
      ...goalBodyRows(),
      row('steps', 5000, '2026-07-10'),
      row('readiness_score', 88, '2026-07-10'),
      row('ahi', 3, '2026-07-10'),
    ];
    expect(buildFocusPanels(rows, NOW, {})).toEqual(buildFocusPanels(rows, NOW));
    expect(
      buildFocusPanels(rows, NOW, { metricGoals: [], frequencyGoals: [], weekSessions: [] }),
    ).toEqual(buildFocusPanels(rows, NOW));
  });

  it('an increase weight goal mirrors the body verdict and weight tone', () => {
    const goals: FocusGoalContext = {
      metricGoals: [{ metricKey: 'weight', direction: 'increase' }],
    };
    expect(panel(goalBodyRows(), 'body', goals).verdict).toEqual({
      label: 'Trending down',
      tone: 'warning',
    });
    const s = stat(goalBodyRows(), 'body', 'weight', goals);
    expect(s.sub).toBe('-1 lbs/wk');
    expect(s.tone).toBe('bad');
  });

  it('a maintain weight goal makes in-band steady read good and trends warn', () => {
    const goals: FocusGoalContext = {
      metricGoals: [{ metricKey: 'weight', direction: 'maintain' }],
    };
    // Trending down 1 lb/wk → off the maintenance band.
    expect(panel(goalBodyRows(), 'body', goals).verdict).toEqual({
      label: 'Trending down',
      tone: 'warning',
    });
    expect(stat(goalBodyRows(), 'body', 'weight', goals).tone).toBe('warn');

    // Steady rows: identical weekly averages → rate 0.
    const steady = [
      row('weight', 210, '2026-07-08'),
      row('weight', 210, '2026-07-01'),
    ];
    expect(panel(steady, 'body', goals).verdict).toEqual({
      label: 'Holding steady',
      tone: 'success',
    });
    expect(stat(steady, 'body', 'weight', goals).tone).toBe('good');
  });

  it('shows target progress when the active weight goal has a targetValue', () => {
    const goals: FocusGoalContext = {
      metricGoals: [{ metricKey: 'weight', direction: 'decrease', targetValue: 200 }],
    };
    const s = stat(goalBodyRows(), 'body', 'weight_goal', goals);
    expect(s.label).toBe('Goal');
    expect(s.value).toBe('200');
    expect(s.unit).toBe('lbs');
    expect(s.sub).toBe('10 lbs to go'); // 7d avg 210 → 200
    expect(s.tone).toBe('neutral');
  });

  it('marks a reached decrease target and an on-target maintain goal good', () => {
    const reached: FocusGoalContext = {
      metricGoals: [{ metricKey: 'weight', direction: 'decrease', targetValue: 215 }],
    };
    expect(stat(goalBodyRows(), 'body', 'weight_goal', reached)).toMatchObject({
      sub: 'reached',
      tone: 'good',
    });
    const maintain: FocusGoalContext = {
      metricGoals: [{ metricKey: 'weight', direction: 'maintain', targetValue: 210.1 }],
    };
    expect(stat(goalBodyRows(), 'body', 'weight_goal', maintain)).toMatchObject({
      sub: 'on target',
      tone: 'good',
    });
    const off: FocusGoalContext = {
      metricGoals: [{ metricKey: 'weight', direction: 'maintain', targetValue: 205 }],
    };
    expect(stat(goalBodyRows(), 'body', 'weight_goal', off)).toMatchObject({
      sub: '+5 lbs vs target',
      tone: 'warn',
    });
  });

  it('omits the goal stat without a targetValue', () => {
    const goals: FocusGoalContext = {
      metricGoals: [{ metricKey: 'weight', direction: 'decrease' }],
    };
    expect(
      panel(goalBodyRows(), 'body', goals).stats.find((s) => s.key === 'weight_goal'),
    ).toBeUndefined();
  });

  it('overrides recovery delta tones (goal beats the registry direction)', () => {
    const rows = [
      row('readiness_score', 80, '2026-07-10'),
      row('resting_hr', 65, '2026-07-10'),
      row('resting_hr', 60, '2026-06-30'),
    ];
    // Registry: resting_hr lower-is-better → +5 is bad.
    expect(stat(rows, 'recovery', 'resting_hr').tone).toBe('bad');
    // Goal says increase → the same +5 reads good.
    const goals: FocusGoalContext = {
      metricGoals: [{ metricKey: 'resting_hr', direction: 'increase' }],
    };
    expect(stat(rows, 'recovery', 'resting_hr', goals).tone).toBe('good');
  });

  it('maintain goals tone recovery deltas: no change good, movement warns', () => {
    const goals: FocusGoalContext = {
      metricGoals: [{ metricKey: 'readiness_score', direction: 'maintain' }],
    };
    const flat = [
      row('readiness_score', 80, '2026-07-10'),
      row('readiness_score', 80, '2026-07-01'),
    ];
    expect(stat(flat, 'recovery', 'readiness_score', goals)).toMatchObject({
      sub: 'no change vs 30d avg',
      tone: 'good',
    });
    const moved = [
      row('readiness_score', 88, '2026-07-10'),
      row('readiness_score', 80, '2026-07-01'),
    ];
    expect(stat(moved, 'recovery', 'readiness_score', goals)).toMatchObject({
      sub: '+4 vs 30d avg',
      tone: 'warn',
    });
  });

  it('a maintain fat_free_mass goal makes steady read good and moves warn', () => {
    const goals: FocusGoalContext = {
      metricGoals: [{ metricKey: 'fat_free_mass', direction: 'maintain' }],
    };
    const steady = [
      ...goalBodyRows(),
      row('fat_free_mass', 150.0, '2026-07-10'),
      row('fat_free_mass', 149.6, '2026-07-05'),
    ];
    expect(stat(steady, 'body', 'fat_free_mass', goals)).toMatchObject({
      sub: 'steady',
      tone: 'good',
    });
    const moved = [
      ...goalBodyRows(),
      row('fat_free_mass', 151.0, '2026-07-10'),
      row('fat_free_mass', 149.0, '2026-07-05'),
    ];
    expect(stat(moved, 'body', 'fat_free_mass', goals).tone).toBe('warn');
  });

  it('threads frequency goals into the activity verdict', () => {
    const rows = [row('steps', 5000, '2026-07-10')];
    const goals: FocusGoalContext = {
      frequencyGoals: [{ sessionType: 'strength', perWeek: 3 }],
      weekSessions: [
        { type: 'strength', startedAt: '2026-07-07T17:00:00Z' },
        { type: 'strength', startedAt: '2026-07-09T17:00:00Z' },
      ],
      timeZone: 'UTC',
    };
    expect(panel(rows, 'activity', goals).verdict).toEqual({
      label: '2/3 lifts this week',
      tone: 'success',
    });
    // Without frequency goals the static badge is untouched.
    expect(panel(rows, 'activity', { metricGoals: [] }).verdict).toEqual({
      label: 'This week',
      tone: 'neutral',
    });
  });
});

// ---------------------------------------------------------------------------
// Activity panel
// ---------------------------------------------------------------------------

describe('activity panel', () => {
  it('is a neutral This week verdict', () => {
    expect(panel([row('steps', 5000, '2026-07-10')], 'activity').verdict).toEqual({
      label: 'This week',
      tone: 'neutral',
    });
  });

  it('computes 7d daily averages with a % delta vs the 30d daily average', () => {
    const rows = [
      row('steps', 1500, '2026-07-09'),
      row('steps', 1500, '2026-07-10'),
      row('steps', 3000, '2026-06-20'),
    ];
    const s = stat(rows, 'activity', 'steps');
    // 7d: 3000/7 ≈ 428.6/day; 30d over 21 days covered: 6000/21 ≈ 285.7 → +50%
    expect(s.value).toBe('429');
    expect(s.sub).toBe('+50% vs 30d avg');
    expect(s.tone).toBe('good');
  });

  it('reports no change when the weekly pace matches the 30d pace', () => {
    const rows = [
      // 7 days × 1000 = 7000 in 7d; +23000 earlier → 30000/30 = 1000/day
      ...['04', '05', '06', '07', '08', '09', '10'].map((d) =>
        row('steps', 1000, `2026-07-${d}`),
      ),
      row('steps', 23000, '2026-06-11'),
    ];
    const s = stat(rows, 'activity', 'steps');
    expect(s.value).toBe('1,000');
    expect(s.sub).toBe('no change vs 30d avg');
    expect(s.tone).toBe('neutral');
  });

  it('divides by days covered when history is shorter than the window', () => {
    const rows = [
      row('steps', 1000, '2026-07-08'),
      row('steps', 1000, '2026-07-09'),
      row('steps', 1000, '2026-07-10'),
    ];
    const s = stat(rows, 'activity', 'steps');
    // First record 3 days ago → both windows cover the same 3 days.
    expect(s.value).toBe('1,000');
    expect(s.sub).toBe('no change vs 30d avg');
  });

  it('day-deduplicates same-day rows instead of double-counting the sum', () => {
    const rows = [
      row('steps', 6000, '2026-07-10'),
      row('steps', 6000, '2026-07-10'), // duplicate reading, same day
      row('steps', 6000, '2026-07-04'),
    ];
    const s = stat(rows, 'activity', 'steps');
    // 2 days × 6000 over 7 days covered... first record Jul 4 → 7 days covered
    expect(s.value).toBe('1,714'); // 12000/7, not 18000/7
  });

  it('includes active calories only when present', () => {
    const stepsOnly = panel([row('steps', 5000, '2026-07-10')], 'activity');
    expect(stepsOnly.stats.map((s) => s.key)).toEqual(['steps']);
    expect(stepsOnly.chartMetrics).toEqual(['steps']);

    const withCals = [
      row('steps', 5000, '2026-07-10'),
      row('active_calories', 700, '2026-07-10'),
    ];
    expect(panel(withCals, 'activity').stats.map((s) => s.key)).toEqual([
      'steps',
      'active_calories',
    ]);
    expect(panel(withCals, 'activity').chartMetrics).toEqual(['steps', 'active_calories']);
  });
});
