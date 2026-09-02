/**
 * Weekly rollup — the computed contract behind GET /api/v1/weeks/{weekStart}
 * (fitness design spec §API): sessions by type with labels, weigh-in and
 * body-composition aggregates, recovery averages, latest body circumferences,
 * active frequency-goal progress, the check-in row, and prior-week deltas.
 *
 * DB-touching aggregation (unlike the pure libs in this directory) — reads
 * workout_sessions, goals, weekly_checkins and vitals directly. Nothing here
 * is ever stored; every call recomputes from source rows.
 *
 * Week windows:
 *  - Sessions carry real timestamps; week membership resolves via the owner's
 *    IANA timezone (weeks.ts). The app has no per-user timezone column, so
 *    OWNER_TZ pins the spec's owner convention (America/Phoenix, MST, no DST)
 *    as the default — callers can override per call when that ever changes.
 *  - Vitals are day-normalized (`recorded_at = <day>T00:00:00Z`, see
 *    src/lib/dates.ts): their UTC date IS the intended local day, so the
 *    vitals window is simply the seven `YYYY-MM-DD` keys of the week.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '@/db';
import { goals, vitals, weeklyCheckins, workoutSessions, SESSION_TYPES } from '@/db/schema';
import type { SessionType } from '@/db/schema';
import { requireAuthz } from '@/lib/authz';
import { BODY_MEASUREMENT_KEYS } from '@/lib/metrics/registry';
import { shiftDayKey } from '@/lib/dates';
import { validateWeekStart } from '@/lib/repos/_fitness';
import type { WeeklyCheckinRow } from '@/lib/repos/checkins';
import { dayKeyInTz, priorWeekStart, weekStartOfDayKey } from './weeks';

/** Owner timezone convention (spec §Timezone). Not stored per user yet. */
export const OWNER_TZ = 'America/Phoenix';

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface SessionTypeRollup {
  count: number;
  /** Distinct non-empty labels, in chronological session order. */
  labels: string[];
}

/** The numeric aggregates that also feed prior-week deltas. */
export interface WeekNumericRollup {
  /** Mean of per-day mean weights over the days that have a weigh-in. */
  weightAvg: number | null;
  /** Lowest single weigh-in of the week (the owner's Notion "min" habit). */
  weightMin: number | null;
  /** Number of distinct days with at least one weight reading. */
  daysWeighed: number;
  bodyFatPctAvg: number | null;
  fatFreeMassAvg: number | null;
  hrvRmssdAvg: number | null;
  readinessScoreAvg: number | null;
  sleepScoreAvg: number | null;
  /** Hours (registry canonical unit for sleep_duration). */
  sleepDurationAvg: number | null;
  sessionsTotal: number;
}

export interface LatestMeasurement {
  value: number;
  recordedAt: string;
  source: string;
}

/** A body-circumference reading as reported by `body.measurementsLatest`.
    `unit` is the registry canonical unit the row is stored in ('in'). */
export interface LatestBodyMeasurement extends LatestMeasurement {
  unit: string | null;
}

/**
 * Latest circumference per canonical metric key, as of the week's end.
 *
 * SPARSE by design: a metric with no reading on or before the week end is
 * ABSENT, not null. The rollup's fixed fields keep their explicit nulls; this
 * is a dictionary keyed by an open, registry-driven vocabulary, so listing
 * every unmeasured key would be noise for clients and for the UI.
 */
export type LatestBodyMeasurements = Record<string, LatestBodyMeasurement>;

export interface FrequencyGoalProgress {
  goalId: string;
  sessionType: SessionType;
  perWeek: number;
  /** Sessions of that type logged this week. */
  completed: number;
  met: boolean;
}

/** current − prior for each numeric rollup; null when either side has no data
    (counts always compare — an empty week counts as 0). */
export type WeekDeltas = {
  [K in keyof WeekNumericRollup]: number | null;
};

export interface WeekRollup {
  weekStart: string;
  /** Sunday of the same week (inclusive). */
  weekEnd: string;
  timezone: string;
  sessions: {
    total: number;
    byType: Record<SessionType, SessionTypeRollup>;
  };
  body: {
    weightAvg: number | null;
    weightMin: number | null;
    daysWeighed: number;
    bodyFatPctAvg: number | null;
    fatFreeMassAvg: number | null;
    /** Latest reading on or before the week's end — not week-scoped, so a
        historical week shows the tape measurement that was current then. */
    neckLatest: LatestMeasurement | null;
    waistLatest: LatestMeasurement | null;
    /** Every registered body-circumference metric with a reading on or before
        the week's end, keyed by canonical metric key. Sparse (see
        LatestBodyMeasurements); neckLatest/waistLatest are the same readings,
        kept as dedicated fields for backward compatibility. */
    measurementsLatest: LatestBodyMeasurements;
  };
  recovery: {
    hrvRmssdAvg: number | null;
    readinessScoreAvg: number | null;
    sleepScoreAvg: number | null;
    sleepDurationAvg: number | null;
  };
  frequencyGoals: FrequencyGoalProgress[];
  checkin: WeeklyCheckinRow | null;
  priorWeekDeltas: WeekDeltas;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Metrics averaged over per-day values (multiple same-day readings from
    different sources collapse to the day's mean first). */
const AVG_METRICS = [
  'weight',
  'body_fat_pct',
  'fat_free_mass',
  'hrv_rmssd',
  'readiness_score',
  'sleep_score',
  'sleep_duration',
] as const;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Per-day mean values for one metric, keyed by day. */
function dayMeans(rows: { recordedAt: string; value: number }[]): Map<string, number> {
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const day = r.recordedAt.slice(0, 10);
    const group = byDay.get(day) ?? [];
    group.push(r.value);
    byDay.set(day, group);
  }
  const out = new Map<string, number>();
  for (const [day, values] of byDay) {
    out.set(day, values.reduce((a, b) => a + b, 0) / values.length);
  }
  return out;
}

interface WeekComputation {
  numeric: WeekNumericRollup;
  byType: Record<SessionType, SessionTypeRollup>;
}

function emptyByType(): Record<SessionType, SessionTypeRollup> {
  return Object.fromEntries(
    SESSION_TYPES.map((t) => [t, { count: 0, labels: [] as string[] }]),
  ) as Record<SessionType, SessionTypeRollup>;
}

/** Sessions whose owner-TZ calendar day falls inside the week. The SQL window
    is padded a day each side (UTC vs local offset) and membership is decided
    in JS via the tz day key — correct for any IANA zone. */
async function sessionsInWeek(userId: string, weekStart: string, tz: string) {
  const rows = await db
    .select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        isNull(workoutSessions.dependentId),
        gte(workoutSessions.startedAt, shiftDayKey(weekStart, -1)),
        lt(workoutSessions.startedAt, shiftDayKey(weekStart, 8)),
      ),
    )
    .orderBy(workoutSessions.startedAt);
  return rows.filter(
    (s) => weekStartOfDayKey(dayKeyInTz(new Date(s.startedAt), tz)) === weekStart,
  );
}

/** One week's numeric aggregates + per-type session rollup. */
async function computeWeek(userId: string, weekStart: string, tz: string): Promise<WeekComputation> {
  const nextMonday = shiftDayKey(weekStart, 7);

  const sessions = await sessionsInWeek(userId, weekStart, tz);
  const byType = emptyByType();
  for (const s of sessions) {
    const bucket = byType[s.type];
    bucket.count += 1;
    const label = s.label?.trim();
    if (label && !bucket.labels.includes(label)) bucket.labels.push(label);
  }

  // Vitals for the week — one query, split by metric. Day-normalized rows
  // sort as `<day>T00:00:00Z`, so [weekStart, nextMonday) string bounds hold.
  const vitalRows = await db
    .select({ metricKey: vitals.metricKey, recordedAt: vitals.recordedAt, value: vitals.value })
    .from(vitals)
    .where(
      and(
        eq(vitals.userId, userId),
        isNull(vitals.dependentId),
        gte(vitals.recordedAt, weekStart),
        lt(vitals.recordedAt, nextMonday),
      ),
    );
  const byMetric = new Map<string, { recordedAt: string; value: number }[]>();
  for (const r of vitalRows) {
    if (!(AVG_METRICS as readonly string[]).includes(r.metricKey)) continue;
    const group = byMetric.get(r.metricKey) ?? [];
    group.push(r);
    byMetric.set(r.metricKey, group);
  }

  const avgOf = (metricKey: (typeof AVG_METRICS)[number]): number | null =>
    mean([...dayMeans(byMetric.get(metricKey) ?? []).values()]);

  const weightRows = byMetric.get('weight') ?? [];
  const weightDays = dayMeans(weightRows);

  return {
    byType,
    numeric: {
      weightAvg: mean([...weightDays.values()]),
      weightMin: weightRows.length
        ? round2(Math.min(...weightRows.map((r) => r.value)))
        : null,
      daysWeighed: weightDays.size,
      bodyFatPctAvg: avgOf('body_fat_pct'),
      fatFreeMassAvg: avgOf('fat_free_mass'),
      hrvRmssdAvg: avgOf('hrv_rmssd'),
      readinessScoreAvg: avgOf('readiness_score'),
      sleepScoreAvg: avgOf('sleep_score'),
      sleepDurationAvg: avgOf('sleep_duration'),
      sessionsTotal: sessions.length,
    },
  };
}

/**
 * Latest reading per body-circumference metric recorded strictly before
 * `beforeDay` — ONE query for the whole vocabulary, not one per metric.
 *
 * Rows come back newest-first and the first row seen per metric wins, so the
 * result is the as-of-week-end series with no future readings. Same-day rows
 * from different sources tie-break on source name, keeping the answer stable
 * across calls.
 */
async function latestBodyMeasurements(
  userId: string,
  beforeDay: string,
): Promise<LatestBodyMeasurements> {
  const rows = await db
    .select({
      metricKey: vitals.metricKey,
      value: vitals.value,
      unit: vitals.unit,
      recordedAt: vitals.recordedAt,
      source: vitals.source,
    })
    .from(vitals)
    .where(
      and(
        eq(vitals.userId, userId),
        isNull(vitals.dependentId),
        inArray(vitals.metricKey, [...BODY_MEASUREMENT_KEYS]),
        lt(vitals.recordedAt, beforeDay),
      ),
    )
    .orderBy(desc(vitals.recordedAt), asc(vitals.source));

  const out: LatestBodyMeasurements = {};
  for (const { metricKey, ...reading } of rows) {
    if (metricKey in out) continue; // newest-first: first hit is the latest
    out[metricKey] = reading;
  }
  // Emit in registry order so clients and the UI render a stable sequence.
  return Object.fromEntries(
    BODY_MEASUREMENT_KEYS.filter((k) => k in out).map((k) => [k, out[k]]),
  );
}

/** The pre-existing neck/waist wire shape: no `unit`, key order unchanged. */
function withoutUnit(reading: LatestBodyMeasurement | undefined): LatestMeasurement | null {
  if (!reading) return null;
  return { value: reading.value, recordedAt: reading.recordedAt, source: reading.source };
}

function computeDeltas(current: WeekNumericRollup, prior: WeekNumericRollup): WeekDeltas {
  const out = {} as WeekDeltas;
  for (const key of Object.keys(current) as (keyof WeekNumericRollup)[]) {
    const cur = current[key];
    const prev = prior[key];
    out[key] = cur === null || prev === null ? null : round2(cur - prev);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Compute the rollup for one Monday-keyed week. Authorization mirrors the
 * fitness repos ('fitness' section, owner scope) — the vitals aggregated in
 * are the same owner's own rows, read as a derived product of the fitness
 * week view. Throws FitnessWriteError (400) for a non-Monday key and
 * NotFoundError (404) for unauthorized actors.
 */
export async function getWeekRollup(
  actorId: string,
  ownerId: string,
  weekStart: string,
  tz: string = OWNER_TZ,
): Promise<WeekRollup> {
  await requireAuthz(actorId, { ownerId, dependentId: null }, 'fitness', 'read');
  validateWeekStart(weekStart);

  const prevStart = priorWeekStart(weekStart);
  const nextMonday = shiftDayKey(weekStart, 7);

  const [current, prior, measurementsLatest, activeFrequencyGoals, checkinRows] =
    await Promise.all([
      computeWeek(ownerId, weekStart, tz),
      computeWeek(ownerId, prevStart, tz),
      latestBodyMeasurements(ownerId, nextMonday),
      db
        .select()
        .from(goals)
        .where(
          and(eq(goals.userId, ownerId), eq(goals.kind, 'frequency'), eq(goals.active, true)),
        )
        .orderBy(goals.createdAt),
      db
        .select()
        .from(weeklyCheckins)
        .where(and(eq(weeklyCheckins.userId, ownerId), eq(weeklyCheckins.weekStart, weekStart)))
        .limit(1),
    ]);

  const frequencyGoals: FrequencyGoalProgress[] = activeFrequencyGoals
    // sessionType/perWeek are non-null for frequency rows written through the
    // goals repo; guard anyway.
    .filter((g) => g.sessionType !== null && g.perWeek !== null)
    .map((g) => {
      const completed = current.byType[g.sessionType as SessionType].count;
      return {
        goalId: g.id,
        sessionType: g.sessionType as SessionType,
        perWeek: g.perWeek as number,
        completed,
        met: completed >= (g.perWeek as number),
      };
    });

  const { sessionsTotal, ...numericBody } = current.numeric;

  return {
    weekStart,
    weekEnd: shiftDayKey(weekStart, 6),
    timezone: tz,
    sessions: { total: sessionsTotal, byType: current.byType },
    body: {
      weightAvg: numericBody.weightAvg,
      weightMin: numericBody.weightMin,
      daysWeighed: numericBody.daysWeighed,
      bodyFatPctAvg: numericBody.bodyFatPctAvg,
      fatFreeMassAvg: numericBody.fatFreeMassAvg,
      neckLatest: withoutUnit(measurementsLatest.neck),
      waistLatest: withoutUnit(measurementsLatest.waist),
      measurementsLatest,
    },
    recovery: {
      hrvRmssdAvg: numericBody.hrvRmssdAvg,
      readinessScoreAvg: numericBody.readinessScoreAvg,
      sleepScoreAvg: numericBody.sleepScoreAvg,
      sleepDurationAvg: numericBody.sleepDurationAvg,
    },
    frequencyGoals,
    checkin: checkinRows[0] ?? null,
    priorWeekDeltas: computeDeltas(current.numeric, prior.numeric),
  };
}
