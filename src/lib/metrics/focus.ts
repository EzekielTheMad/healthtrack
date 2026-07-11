// ---------------------------------------------------------------------------
// Focus view panel models — goal-oriented vitals default (v0.2.2 spec).
//
// Pure module: turns raw vitals rows into up to four goal panels (sleep apnea
// therapy, recovery today, body composition, activity), each with a verdict
// badge, a small stat grid, and — for apnea — a 14-night evidence strip.
// A panel is built only when its required metrics have data, so self-hosters
// see panels appear as their devices start reporting (zero config).
//
// All math takes rows + an injectable `now`. Window helpers are shared with
// aggregate.ts (DAY_MS / windowValue); day bucketing uses the UTC day keys
// from src/lib/dates.ts (non-intraday rows are day-normalized).
//
// Goal semantics (fitness-domain design §goals): an active metric goal
// overrides the registry goalDirection in every delta tone here and drives
// the body verdict; active frequency goals replace the activity panel's
// static badge with week progress. Passing no goal context reproduces the
// registry-default behavior exactly.
// ---------------------------------------------------------------------------

import { DAY_MS, windowValue } from './aggregate';
import { formatUtcDay, getVitalDayKey, shiftDayKey } from '../dates';
import {
  deltaTone,
  resolveGoalDirection,
  type ActiveMetricGoal,
  type DeltaTone,
  type EffectiveGoalDirection,
} from '../fitness/goal-direction';
import { dayKeyInTz, weekStartOfDayKey } from '../fitness/weeks';
import { formatMetricValue } from './format';
import { getMetric } from './registry';

/** Structural subset of `Vital` — snake_case API rows are assignable. */
export interface FocusVitalRow {
  metric_key: string;
  value: number;
  recorded_at: string;
}

export type VerdictTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface Verdict {
  label: string;
  tone: VerdictTone;
}

/** Tone of a stat's sub line: good=sage, warn=amber, bad=terracotta. */
export type StatTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface FocusStat {
  /** Metric key or panel-specific stat id (e.g. 'adherence'). */
  key: string;
  label: string;
  /** Formatted big value (may embed its own suffix, e.g. '78%'). */
  value: string;
  unit: string | null;
  /** Small context/delta line under the value, null when unavailable. */
  sub: string | null;
  tone: StatTone;
}

/** One night of the apnea evidence strip (ascending, ends at "today"). */
export interface ApneaNight {
  dayKey: string;
  /** Nightly AHI (same-day mean), null when not recorded. */
  ahi: number | null;
  /** False = night without CPAP use — rendered as a gray bar. */
  used: boolean;
}

export type FocusPanelId = 'apnea' | 'recovery' | 'body' | 'activity';

// ---------------------------------------------------------------------------
// Goal context (all optional — an empty context is the no-goals experience)
// ---------------------------------------------------------------------------

/** Active metric-kind goal slice the panels need (+ optional target). */
export interface FocusMetricGoal extends ActiveMetricGoal {
  targetValue?: number | null;
}

/** Active frequency-kind goal: N sessions of a type per week. */
export interface FocusFrequencyGoal {
  sessionType: string;
  perWeek: number;
}

/** Workout session slice for weekly frequency counting. */
export interface FocusWeekSession {
  type: string;
  /** Real timestamp (ISO) — bucketed into Monday weeks in `timeZone`. */
  startedAt: string;
}

export interface FocusGoalContext {
  metricGoals?: readonly FocusMetricGoal[];
  frequencyGoals?: readonly FocusFrequencyGoal[];
  /** Recent workout sessions; only the current week's are counted. */
  weekSessions?: readonly FocusWeekSession[];
  /** IANA timezone for Monday-anchored weeks (viewer-local; default UTC). */
  timeZone?: string;
}

const NO_GOALS: readonly FocusMetricGoal[] = [];

export interface FocusPanel {
  id: FocusPanelId;
  title: string;
  verdict: Verdict;
  stats: FocusStat[];
  /** Footnote explaining the panel's encoding/derivation, if any. */
  caption: string | null;
  /** Apnea only: last-14-nights evidence strip. */
  nights: ApneaNight[] | null;
  /** Metric keys (with data) for the expanded inline charts. */
  chartMetrics: string[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const NOT_ENOUGH_DATA: Verdict = { label: 'Not enough data', tone: 'neutral' };

/** Formatted at `decimals`, trailing zeros stripped (matches vitals-view). */
function fmtNum(value: number, decimals: number): string {
  return Number(value.toFixed(decimals)).toString();
}

function signed(value: number, decimals: number): string {
  return `${value > 0 ? '+' : ''}${fmtNum(value, decimals)}`;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rowsFor(rows: FocusVitalRow[], key: string): FocusVitalRow[] {
  return rows.filter((r) => r.metric_key === key);
}

/** Row with the max recorded_at (ISO strings — string compare is safe). */
function latestOf(rows: FocusVitalRow[]): FocusVitalRow {
  let latest = rows[0];
  for (const r of rows) {
    if (r.recorded_at > latest.recorded_at) latest = r;
  }
  return latest;
}

/**
 * Day-deduplicated values (same-day means) in the trailing `days`-day window
 * ending on `todayKey` inclusive — the same bucketing the apnea and weight
 * paths use, so duplicate same-day rows never double-count. `excludeDay`
 * drops one day key from the window (baselines that must not contain the
 * reading they are compared against).
 */
function dailyValuesInWindow(
  rows: FocusVitalRow[],
  metricKey: string,
  todayKey: string,
  days: number,
  excludeDay?: string,
): number[] {
  const cut = shiftDayKey(todayKey, -(days - 1));
  const out: number[] = [];
  for (const [k, v] of dailyMeans(rows, metricKey, todayKey)) {
    if (k >= cut && k !== excludeDay) out.push(v);
  }
  return out;
}

/** Same-day mean per UTC day key (day-normalized metrics), keys ≤ todayKey. */
function dailyMeans(
  rows: FocusVitalRow[],
  metricKey: string,
  todayKey: string,
): Map<string, number> {
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const k = getVitalDayKey(r.recorded_at, metricKey);
    if (k > todayKey) continue;
    const list = byDay.get(k);
    if (list) list.push(r.value);
    else byDay.set(k, [r.value]);
  }
  const out = new Map<string, number>();
  for (const [k, vals] of byDay) out.set(k, mean(vals));
  return out;
}

/** Whole days between two YYYY-MM-DD day keys (b − a). */
function diffDays(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS,
  );
}

/** UTC day key of `now` (day-normalized row convention). */
function utcDayKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

/**
 * deltaTone → StatTone: drifting off a `maintain` goal reads as a caution
 * (amber warn), not a failure — the app's warn tone is the vocabulary for
 * "off the maintenance band" (spec §goals maintain semantics).
 */
function goalStatTone(
  tone: DeltaTone,
  direction: EffectiveGoalDirection | undefined,
): StatTone {
  return tone === 'bad' && direction === 'maintain' ? 'warn' : tone;
}

/**
 * Delta sub line vs a baseline: signed amount + suffix, toned against the
 * EFFECTIVE goal direction (active metric goal over registry default).
 * Deltas that round to zero at `decimals` read as "no change" — neutral for
 * higher/lower, positive (good) for `maintain`, where holding steady is the
 * goal; out-of-band maintain moves warn.
 */
function deltaSub(
  delta: number,
  decimals: number,
  direction: EffectiveGoalDirection | undefined,
  suffix: string,
): { sub: string; tone: StatTone } {
  const band = 0.5 * 10 ** -decimals;
  const tone = goalStatTone(deltaTone(delta, direction, band), direction);
  if (Math.abs(delta) < band) {
    return { sub: `no change ${suffix}`, tone };
  }
  return { sub: `${signed(delta, decimals)} ${suffix}`, tone };
}

/** Percent-delta variant of deltaSub (whole-percent precision — a band of 1
    makes deltaTone's in-band check exactly "rounds to 0%"). */
function pctDeltaSub(
  latest: number,
  baseline: number,
  direction: EffectiveGoalDirection | undefined,
  suffix: string,
): { sub: string; tone: StatTone } {
  const pct = Math.round(((latest - baseline) / Math.abs(baseline)) * 100);
  const tone = goalStatTone(deltaTone(pct, direction, 1), direction);
  if (pct === 0) return { sub: `no change ${suffix}`, tone };
  return { sub: `${pct > 0 ? '+' : ''}${pct}% ${suffix}`, tone };
}

/**
 * Effective direction for a stat delta: active metric goal wins, then the
 * registry default. `?? 'higher'` preserves the pre-goals behavior for
 * direction-less metrics (they were toned as higher-is-better here).
 */
function statDirection(
  key: string,
  metricGoals: readonly FocusMetricGoal[],
): EffectiveGoalDirection {
  return resolveGoalDirection(key, getMetric(key)?.goalDirection, metricGoals) ?? 'higher';
}

// ---------------------------------------------------------------------------
// Verdicts (exported for threshold tests)
// ---------------------------------------------------------------------------

/**
 * Sleep apnea verdict from the 30d AHI average over used nights:
 * <5 well controlled, 5–15 partially controlled, >15 needs attention;
 * fewer than 5 used nights (or no AHI readings) → not enough data.
 */
export function apneaVerdict(avgAhi: number | null, usedNights: number): Verdict {
  if (avgAhi === null || usedNights < 5) return NOT_ENOUGH_DATA;
  if (avgAhi < 5) return { label: 'Well controlled', tone: 'success' };
  if (avgAhi <= 15) return { label: 'Partially controlled', tone: 'warning' };
  return { label: 'Needs attention', tone: 'danger' };
}

/**
 * Recovery verdict from the latest readiness score (Oura bands: ≥85 / 70–84 /
 * 55–69 / <55). Without readiness, derived from latest HRV vs its 30d mean
 * with a ±10% band (above → Primed, below → Take it easier).
 */
export function recoveryVerdict(
  readiness: number | null,
  hrvLatest: number | null,
  hrvMean30: number | null,
): Verdict {
  if (readiness !== null) {
    if (readiness >= 85) return { label: 'Primed', tone: 'success' };
    if (readiness >= 70) return { label: 'Ready to train', tone: 'success' };
    if (readiness >= 55) return { label: 'Take it easier', tone: 'warning' };
    return { label: 'Rest day', tone: 'danger' };
  }
  if (hrvLatest !== null && hrvMean30 !== null && hrvMean30 > 0) {
    const rel = (hrvLatest - hrvMean30) / hrvMean30;
    if (rel >= 0.1) return { label: 'Primed', tone: 'success' };
    if (rel <= -0.1) return { label: 'Take it easier', tone: 'warning' };
    return { label: 'Ready to train', tone: 'success' };
  }
  return NOT_ENOUGH_DATA;
}

/** Weekly rate outside ±0.2 lbs/wk reads as a real trend (shared band). */
const WEIGHT_RATE_BAND = 0.2;

/**
 * Body-composition verdict from the weekly rate of the 7d rolling weight
 * average, judged against the active weight goal's direction:
 *  - decrease (default — the pre-goals weight-loss behavior): ≤−0.2 lbs/wk
 *    trending down (success), ≥+0.2 trending up (warning), else neutral;
 *  - increase: exact mirror;
 *  - maintain: inside the ±0.2 band "Holding steady" is the SUCCESS state,
 *    and either trend direction warns.
 */
export function bodyVerdict(
  ratePerWeek: number | null,
  direction: ActiveMetricGoal['direction'] = 'decrease',
): Verdict {
  if (ratePerWeek === null) return NOT_ENOUGH_DATA;
  const down = ratePerWeek <= -WEIGHT_RATE_BAND;
  const up = ratePerWeek >= WEIGHT_RATE_BAND;
  if (!down && !up) {
    return {
      label: 'Holding steady',
      tone: direction === 'maintain' ? 'success' : 'neutral',
    };
  }
  const label = down ? 'Trending down' : 'Trending up';
  if (direction === 'maintain') return { label, tone: 'warning' };
  const wanted = direction === 'decrease' ? down : up;
  return { label, tone: wanted ? 'success' : 'warning' };
}

// ---------------------------------------------------------------------------
// Frequency-goal week progress (activity panel verdict)
// ---------------------------------------------------------------------------

/** Display order + badge nouns for session types (schema SESSION_TYPES). */
const SESSION_TYPE_ORDER = ['strength', 'cardio', 'mobility', 'other'] as const;
const SESSION_TYPE_NOUNS: Record<string, string> = {
  strength: 'lifts',
  cardio: 'cardio',
  mobility: 'mobility',
  other: 'other',
};

/**
 * Activity verdict from active frequency goals vs this week's sessions
 * (Monday-anchored week in `timeZone`, per the fitness weeks convention).
 * Label: "2/3 lifts · 1/2 cardio this week". Null without active goals —
 * the caller keeps the neutral "This week" badge.
 *
 * On-pace heuristic (deliberately simple): assume at most one session of a
 * given type per remaining day, today included. If every goal's remaining
 * count still fits in the days left, the week is winnable → success (also
 * covers "all done"); otherwise the week is mostly elapsed for that goal →
 * warning. E.g. 0/3 lifts warns from Saturday (2 days left), not before.
 */
export function frequencyVerdict(
  frequencyGoals: readonly FocusFrequencyGoal[],
  weekSessions: readonly FocusWeekSession[],
  now: Date,
  timeZone: string,
): Verdict | null {
  if (frequencyGoals.length === 0) return null;

  const todayKey = dayKeyInTz(now, timeZone);
  const weekStart = weekStartOfDayKey(todayKey);

  const counts = new Map<string, number>();
  for (const s of weekSessions) {
    if (Number.isNaN(Date.parse(s.startedAt))) continue;
    const sessionWeek = weekStartOfDayKey(dayKeyInTz(new Date(s.startedAt), timeZone));
    if (sessionWeek !== weekStart) continue;
    counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  }

  const ordered = [...frequencyGoals].sort(
    (a, b) =>
      SESSION_TYPE_ORDER.indexOf(a.sessionType as (typeof SESSION_TYPE_ORDER)[number]) -
      SESSION_TYPE_ORDER.indexOf(b.sessionType as (typeof SESSION_TYPE_ORDER)[number]),
  );
  const label = `${ordered
    .map(
      (g) =>
        `${counts.get(g.sessionType) ?? 0}/${g.perWeek} ${
          SESSION_TYPE_NOUNS[g.sessionType] ?? g.sessionType
        }`,
    )
    .join(' · ')} this week`;

  const daysLeftInclToday = 7 - diffDays(weekStart, todayKey); // Mon → 7 … Sun → 1
  const onPace = ordered.every(
    (g) => Math.max(0, g.perWeek - (counts.get(g.sessionType) ?? 0)) <= daysLeftInclToday,
  );
  return { label, tone: onPace ? 'success' : 'warning' };
}

// ---------------------------------------------------------------------------
// CPAP adherence
// ---------------------------------------------------------------------------

/** Standard clinical compliance threshold: a night counts at ≥4h of usage. */
const CPAP_COMPLIANT_HOURS = 4;
/** Compliant when at least 70% of window nights meet the 4-hour threshold. */
const CPAP_COMPLIANT_RATIO = 0.7;

export interface CpapAdherence {
  /** Rounded % of nights with ≥4h usage in the window. */
  pct: number;
  /** Nights meeting the 4-hour compliance threshold. */
  usedNights: number;
  /** Nights from the first cpap record (capped 90d back) through yesterday —
      today only counts once tonight has a record. */
  totalNights: number;
  /** Mean nightly hours over used nights, null when none were used. */
  avgHours: number | null;
  /** Standard compliance framing: ≥70% of nights at ≥4h. */
  compliant: boolean;
}

/**
 * Adherence since the FIRST cpap_usage record (window start capped at 90 days
 * back), through YESTERDAY — tonight can't be missing before it happens, so
 * today only joins the denominator once it has a record. A night counts as
 * used at the clinical compliance threshold: daily usage (same-day mean) of
 * 4 hours or more; shorter, recorded-zero, and missing nights are unused.
 * Null without any cpap_usage rows.
 */
export function cpapAdherence(rows: FocusVitalRow[], now: Date): CpapAdherence | null {
  const usage = rowsFor(rows, 'cpap_usage');
  if (usage.length === 0) return null;

  const todayKey = utcDayKey(now);
  const daily = dailyMeans(usage, 'cpap_usage', todayKey);
  if (daily.size === 0) return null; // only future-dated rows

  let firstKey = todayKey;
  for (const k of daily.keys()) {
    if (k < firstKey) firstKey = k;
  }
  const capStart = shiftDayKey(todayKey, -89);
  const start = firstKey > capStart ? firstKey : capStart;
  const end = daily.has(todayKey) ? todayKey : shiftDayKey(todayKey, -1);

  const totalNights = diffDays(start, end) + 1;
  const usedHours: number[] = [];
  for (const [k, hours] of daily) {
    if (k >= start && hours >= CPAP_COMPLIANT_HOURS) usedHours.push(hours);
  }
  const usedNights = usedHours.length;

  return {
    pct: Math.round((usedNights / totalNights) * 100),
    usedNights,
    totalNights,
    avgHours: usedNights > 0 ? mean(usedHours) : null,
    compliant: usedNights / totalNights >= CPAP_COMPLIANT_RATIO,
  };
}

// ---------------------------------------------------------------------------
// Weight trend
// ---------------------------------------------------------------------------

export interface WeightTrend {
  /** Mean of daily weights over the last 7 UTC days, null when empty. */
  avg7: number | null;
  /** avg(last 7 days) − avg(prior 7 days) in lbs/week, null when either window is empty. */
  ratePerWeek: number | null;
}

/**
 * 7d rolling weight average and its weekly rate, on UTC day keys (weight rows
 * are day-normalized). Multiple same-day readings average into one daily value.
 */
export function weightTrend(rows: FocusVitalRow[], now: Date): WeightTrend {
  const todayKey = utcDayKey(now);
  const daily = dailyMeans(rowsFor(rows, 'weight'), 'weight', todayKey);

  const w1Start = shiftDayKey(todayKey, -6); // last 7 days inclusive of today
  const w2Start = shiftDayKey(todayKey, -13); // prior 7 days

  const last7: number[] = [];
  const prior7: number[] = [];
  for (const [k, v] of daily) {
    if (k >= w1Start) last7.push(v);
    else if (k >= w2Start) prior7.push(v);
  }

  const avg7 = last7.length > 0 ? mean(last7) : null;
  const avgPrior = prior7.length > 0 ? mean(prior7) : null;
  return {
    avg7,
    ratePerWeek: avg7 !== null && avgPrior !== null ? avg7 - avgPrior : null,
  };
}

// ---------------------------------------------------------------------------
// Panel builders
// ---------------------------------------------------------------------------

/** Chart-metric keys filtered to those with data, preserving order. */
function chartMetricsWithData(rows: FocusVitalRow[], keys: string[]): string[] {
  const present = new Set(rows.map((r) => r.metric_key));
  return keys.filter((k) => present.has(k));
}

function buildApneaPanel(rows: FocusVitalRow[], now: Date): FocusPanel | null {
  const ahiRows = rowsFor(rows, 'ahi');
  const usageRows = rowsFor(rows, 'cpap_usage');
  if (ahiRows.length === 0 && usageRows.length === 0) return null;

  const todayKey = utcDayKey(now);
  const cut30 = shiftDayKey(todayKey, -29);
  const ahiDaily = dailyMeans(ahiRows, 'ahi', todayKey);
  const usageDaily = dailyMeans(usageRows, 'cpap_usage', todayKey);
  const hasUsage = usageDaily.size > 0;

  // Nights USED in the trailing 30 days: usage > 0 when usage data exists,
  // otherwise every night with an AHI reading (device only reports used nights).
  const usedKeys30 = new Set<string>();
  if (hasUsage) {
    for (const [k, hours] of usageDaily) {
      if (k >= cut30 && hours > 0) usedKeys30.add(k);
    }
  } else {
    for (const k of ahiDaily.keys()) {
      if (k >= cut30) usedKeys30.add(k);
    }
  }

  const ahiUsed: number[] = [];
  for (const k of usedKeys30) {
    const v = ahiDaily.get(k);
    if (v !== undefined) ahiUsed.push(v);
  }
  const avgAhi = ahiUsed.length > 0 ? mean(ahiUsed) : null;
  const verdict = apneaVerdict(avgAhi, usedKeys30.size);

  const stats: FocusStat[] = [];
  if (ahiRows.length > 0) {
    stats.push({
      key: 'ahi',
      label: 'AHI (30d avg)',
      value: avgAhi !== null ? fmtNum(avgAhi, 1) : '—',
      unit: 'events/hr',
      sub: 'goal <5',
      tone:
        avgAhi === null ? 'neutral' : avgAhi < 5 ? 'good' : avgAhi <= 15 ? 'warn' : 'bad',
    });
  }
  const adherence = cpapAdherence(rows, now);
  if (adherence !== null) {
    stats.push({
      key: 'adherence',
      label: 'Adherence',
      value: `${adherence.pct}%`,
      unit: null,
      sub: `${adherence.usedNights}/${adherence.totalNights} nights ≥4h`,
      tone: adherence.compliant ? 'good' : 'warn',
    });
  }
  const leakDaily = dailyMeans(rowsFor(rows, 'mask_leak'), 'mask_leak', todayKey);
  if (leakDaily.size > 0) {
    let nightsOver = 0;
    for (const [k, v] of leakDaily) {
      if (k >= cut30 && v > 24) nightsOver += 1;
    }
    stats.push({
      key: 'mask_leak',
      label: 'Mask leak (30d)',
      value: nightsOver === 0 ? 'OK' : String(nightsOver),
      unit: null,
      sub: nightsOver === 0 ? '0 nights over limit' : 'nights over 24 L/min (30d)',
      tone: nightsOver === 0 ? 'good' : 'warn',
    });
  }

  // Evidence strip: last 14 nights, ascending, ending today.
  const nights: ApneaNight[] = [];
  for (let i = 13; i >= 0; i -= 1) {
    const k = shiftDayKey(todayKey, -i);
    const ahi = ahiDaily.get(k) ?? null;
    nights.push({
      dayKey: k,
      ahi,
      used: hasUsage ? (usageDaily.get(k) ?? 0) > 0 : ahi !== null,
    });
  }

  return {
    id: 'apnea',
    title: 'Sleep apnea therapy',
    verdict,
    stats,
    caption: 'Last 14 nights — bar height is nightly AHI; gray means no CPAP use.',
    nights,
    chartMetrics: chartMetricsWithData(rows, ['ahi', 'cpap_usage', 'mask_leak']),
  };
}

function buildRecoveryPanel(
  rows: FocusVitalRow[],
  now: Date,
  metricGoals: readonly FocusMetricGoal[],
): FocusPanel | null {
  const readinessRows = rowsFor(rows, 'readiness_score');
  const hrvRows = rowsFor(rows, 'hrv_rmssd');
  if (readinessRows.length === 0 && hrvRows.length === 0) return null;

  const todayKey = utcDayKey(now);

  const readinessLatest = readinessRows.length > 0 ? latestOf(readinessRows).value : null;
  const hrvLatestRow = hrvRows.length > 0 ? latestOf(hrvRows) : null;
  const hrvLatest = hrvLatestRow !== null ? hrvLatestRow.value : null;
  // Fallback baseline: 30d of daily means EXCLUDING the latest reading's own
  // day — the norm must not contain the value it is compared against.
  const hrvMean30 =
    hrvLatestRow !== null
      ? windowValue(
          'mean',
          dailyValuesInWindow(
            hrvRows,
            'hrv_rmssd',
            todayKey,
            30,
            getVitalDayKey(hrvLatestRow.recorded_at, 'hrv_rmssd'),
          ),
        )
      : null;
  const verdict = recoveryVerdict(readinessLatest, hrvLatest, hrvMean30);

  /** "Jul 8" when a metric's latest reading is older than 48h, else null. */
  const staleDay = (metricRows: FocusVitalRow[]): string | null => {
    if (metricRows.length === 0) return null;
    const latest = latestOf(metricRows);
    const t = Date.parse(latest.recorded_at);
    if (Number.isNaN(t) || now.getTime() - t <= 2 * DAY_MS) return null;
    return formatUtcDay(latest.recorded_at);
  };

  const stats: FocusStat[] = [];
  const pushDelta = (
    key: string,
    label: string,
    metricRows: FocusVitalRow[],
    unit: string | null,
    decimals: number,
    percent: boolean,
  ) => {
    if (metricRows.length === 0) return;
    const direction = statDirection(key, metricGoals);
    const latest = latestOf(metricRows).value;
    const mean30 = windowValue('mean', dailyValuesInWindow(metricRows, key, todayKey, 30));
    let sub: string | null = null;
    let tone: StatTone = 'neutral';
    if (mean30 !== null) {
      const d = percent
        ? pctDeltaSub(latest, mean30, direction, 'vs 30d avg')
        : deltaSub(latest - mean30, decimals, direction, 'vs 30d avg');
      sub = d.sub;
      tone = d.tone;
    }
    stats.push({ key, label, value: fmtNum(latest, decimals), unit, sub, tone });
  };

  pushDelta('readiness_score', 'Readiness', readinessRows, null, 0, false);
  pushDelta('hrv_rmssd', 'HRV', hrvRows, 'ms', 0, true);
  pushDelta('resting_hr', 'Resting HR', rowsFor(rows, 'resting_hr'), 'bpm', 0, false);
  const sleepRows = rowsFor(rows, 'sleep_duration');
  const sleepStale = staleDay(sleepRows);
  pushDelta(
    'sleep_duration',
    sleepStale !== null ? `Sleep (${sleepStale})` : 'Sleep last night',
    sleepRows,
    'hrs',
    1,
    false,
  );

  // The verdict reads as "today" — when the reading behind it is older than
  // 48h, date the panel instead of presenting it as current.
  const verdictStale = staleDay(readinessRows.length > 0 ? readinessRows : hrvRows);

  return {
    id: 'recovery',
    title: verdictStale !== null ? `Recovery (${verdictStale})` : 'Recovery today',
    verdict,
    stats,
    caption:
      readinessLatest === null && hrvLatest !== null && hrvMean30 !== null
        ? 'Verdict derived from HRV vs its 30-day norm (±10%).'
        : null,
    nights: null,
    chartMetrics: chartMetricsWithData(rows, [
      'readiness_score',
      'hrv_rmssd',
      'resting_hr',
    ]),
  };
}

function buildBodyPanel(
  rows: FocusVitalRow[],
  now: Date,
  metricGoals: readonly FocusMetricGoal[],
): FocusPanel | null {
  const weightRows = rowsFor(rows, 'weight');
  if (weightRows.length === 0) return null;

  const { avg7, ratePerWeek } = weightTrend(rows, now);
  // The active weight goal drives the verdict; without one the pre-goals
  // weight-loss framing (decrease) applies unchanged.
  const weightGoal = metricGoals.find((g) => g.metricKey === 'weight');
  const goalDirection = weightGoal?.direction ?? 'decrease';
  const verdict = bodyVerdict(ratePerWeek, goalDirection);

  const stats: FocusStat[] = [];
  let weightSub: string | null = null;
  let weightTone: StatTone = 'neutral';
  if (ratePerWeek !== null) {
    weightSub = `${signed(ratePerWeek, 1)} lbs/wk`;
    const down = ratePerWeek <= -WEIGHT_RATE_BAND;
    const up = ratePerWeek >= WEIGHT_RATE_BAND;
    if (goalDirection === 'maintain') weightTone = down || up ? 'warn' : 'good';
    else if (down || up) {
      weightTone = (goalDirection === 'decrease') === down ? 'good' : 'bad';
    }
  }
  const currentWeight = avg7 ?? latestOf(weightRows).value;
  stats.push({
    key: 'weight',
    label: avg7 !== null ? 'Weight (7d avg)' : 'Weight (latest)',
    value: fmtNum(currentWeight, 1),
    unit: 'lbs',
    sub: weightSub,
    tone: weightTone,
  });

  // Target progress when the active weight goal carries a targetValue —
  // rendered as a stat cell in the panel's existing grid style.
  if (weightGoal?.targetValue != null) {
    const target = weightGoal.targetValue;
    const diff = currentWeight - target;
    let sub: string;
    let tone: StatTone;
    if (weightGoal.direction === 'maintain') {
      const onTarget = Math.abs(diff) < WEIGHT_RATE_BAND;
      sub = onTarget ? 'on target' : `${signed(diff, 1)} lbs vs target`;
      tone = onTarget ? 'good' : 'warn';
    } else {
      const reached =
        weightGoal.direction === 'decrease' ? currentWeight <= target : currentWeight >= target;
      sub = reached ? 'reached' : `${fmtNum(Math.abs(diff), 1)} lbs to go`;
      tone = reached ? 'good' : 'neutral';
    }
    stats.push({
      key: 'weight_goal',
      label: 'Goal',
      value: fmtNum(target, 1),
      unit: 'lbs',
      sub,
      tone,
    });
  }

  /** Latest + previous reading of a metric, by recorded_at. */
  const lastTwo = (key: string): [FocusVitalRow, FocusVitalRow | null] | null => {
    const list = rowsFor(rows, key);
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    return [sorted[0], sorted[1] ?? null];
  };

  const bf = lastTwo('body_fat_pct');
  if (bf) {
    const [latest, prev] = bf;
    let sub: string | null = null;
    let tone: StatTone = 'neutral';
    if (prev) {
      const d = deltaSub(
        latest.value - prev.value,
        1,
        statDirection('body_fat_pct', metricGoals), // registry: lower
        'vs prior reading',
      );
      sub = d.sub;
      tone = d.tone;
    }
    stats.push({
      key: 'body_fat_pct',
      label: 'Body fat',
      value: fmtNum(latest.value, 1),
      unit: '%',
      sub,
      tone,
    });
  }

  const ffm = lastTwo('fat_free_mass');
  if (ffm) {
    const [latest, prev] = ffm;
    let sub: string | null = null;
    let tone: StatTone = 'neutral';
    if (prev) {
      const diff = latest.value - prev.value;
      // Registry default 'higher' — keeping lean mass is the goal; an active
      // fat_free_mass goal (e.g. maintain) overrides. The bespoke ±0.5 lb
      // "steady" band is wider than a display half-step, so it stays local.
      const direction = statDirection('fat_free_mass', metricGoals);
      if (Math.abs(diff) <= 0.5) {
        sub = 'steady';
        tone = direction === 'maintain' ? 'good' : 'neutral';
      } else {
        sub = `${signed(diff, 1)} vs prior reading`;
        tone =
          direction === 'maintain'
            ? 'warn'
            : (diff > 0) === (direction === 'higher')
              ? 'good'
              : 'bad';
      }
    }
    stats.push({
      key: 'fat_free_mass',
      label: 'Fat-free mass',
      value: fmtNum(latest.value, 1),
      unit: 'lbs',
      sub,
      tone,
    });
  }

  return {
    id: 'body',
    title: 'Body composition',
    verdict,
    stats,
    caption: 'Trend uses a 7-day rolling average.',
    nights: null,
    chartMetrics: chartMetricsWithData(rows, ['weight', 'body_fat_pct', 'fat_free_mass']),
  };
}

function buildActivityPanel(
  rows: FocusVitalRow[],
  now: Date,
  goals: FocusGoalContext,
): FocusPanel | null {
  const stepsRows = rowsFor(rows, 'steps');
  if (stepsRows.length === 0) return null;

  const metricGoals = goals.metricGoals ?? NO_GOALS;

  const todayKey = utcDayKey(now);
  const stats: FocusStat[] = [];
  const pushDailyAvg = (
    key: string,
    label: string,
    metricRows: FocusVitalRow[],
    unit: string | null,
  ) => {
    if (metricRows.length === 0) return;
    const daily = dailyMeans(metricRows, key, todayKey);
    if (daily.size === 0) return; // only future-dated rows
    let firstKey = todayKey;
    for (const k of daily.keys()) {
      if (k < firstKey) firstKey = k;
    }
    // Daily averages divide by days COVERED, not the full window — with 3
    // days of history, "total / 7" would understate the honest daily pace.
    // Both windows share the coverage cap so the comparison stays like-for-like.
    const coverage = diffDays(firstKey, todayKey) + 1;
    const total7 = windowValue('sum', dailyValuesInWindow(metricRows, key, todayKey, 7)) ?? 0;
    const total30 = windowValue('sum', dailyValuesInWindow(metricRows, key, todayKey, 30)) ?? 0;
    const avg7 = total7 / Math.min(7, coverage);
    const avg30 = total30 / Math.min(30, coverage);
    let sub: string | null = null;
    let tone: StatTone = 'neutral';
    if (avg30 > 0) {
      const d = pctDeltaSub(avg7, avg30, statDirection(key, metricGoals), 'vs 30d avg');
      sub = d.sub;
      tone = d.tone;
    }
    stats.push({ key, label, value: formatMetricValue(avg7, 0), unit, sub, tone });
  };

  pushDailyAvg('steps', 'Steps (7d daily avg)', stepsRows, null);
  pushDailyAvg(
    'active_calories',
    'Active calories (7d daily avg)',
    rowsFor(rows, 'active_calories'),
    'kcal',
  );

  // Frequency-goal week progress replaces the static badge when active
  // frequency goals exist; otherwise the pre-goals neutral badge stays.
  const verdict =
    frequencyVerdict(
      goals.frequencyGoals ?? [],
      goals.weekSessions ?? [],
      now,
      goals.timeZone ?? 'UTC',
    ) ?? { label: 'This week', tone: 'neutral' };

  return {
    id: 'activity',
    title: 'Activity',
    verdict,
    stats,
    caption: null,
    nights: null,
    chartMetrics: chartMetricsWithData(rows, ['steps', 'active_calories']),
  };
}

/**
 * Build the ordered Focus panels (apnea, recovery, body, activity) from raw
 * vitals rows. Ordinal and registry-unknown metrics are ignored; panels whose
 * required metrics have no data are omitted entirely. `goals` threads the
 * user's active goals into delta tones and verdicts — omitting it (or passing
 * an empty context) reproduces the registry-default behavior exactly.
 */
export function buildFocusPanels(
  rows: FocusVitalRow[],
  now: Date = new Date(),
  goals: FocusGoalContext = {},
): FocusPanel[] {
  const numeric = rows.filter((r) => {
    const metric = getMetric(r.metric_key);
    return metric !== undefined && metric.valueType !== 'ordinal';
  });

  const metricGoals = goals.metricGoals ?? NO_GOALS;
  const panels = [
    buildApneaPanel(numeric, now),
    buildRecoveryPanel(numeric, now, metricGoals),
    buildBodyPanel(numeric, now, metricGoals),
    buildActivityPanel(numeric, now, goals),
  ];
  return panels.filter((p): p is FocusPanel => p !== null);
}
