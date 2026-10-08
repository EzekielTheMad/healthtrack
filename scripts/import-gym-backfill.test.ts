// @vitest-environment node
/**
 * Pure transform and temp-SQLite integration tests using independently
 * synthetic gym data. No records or notes are copied from a real export.
 * Covers warmups, per-arm loads, timed sets, multipliers, relation ordering,
 * mismatches, cardio notes, populated/skeleton weeks and repeat imports.
 */
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildPlan,
  loadExport,
  mapExerciseName,
  normalizeSetString,
  notionDateToIso,
  parseAllSets,
  parseCardioNotes,
  parseCliArgs,
  parseEnergy,
  sessionTitleToTypeLabel,
  EXERCISE_SEEDS,
  type ExportData,
} from './import-gym-backfill';
import { syntheticGymExport } from './generate-synthetic-gym-fixtures';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  type RepoTestDb,
} from '../src/lib/repos/repo-test-harness';

const FIXTURE_DIR = path.join(process.cwd(), 'scripts', 'fixtures', 'gym-export');

// Abort before value-bearing assertions if a real export is accidentally copied
// into the fixture directory. Never echo replacement records in the failure.
const fixtureIsSynthetic =
  JSON.stringify(loadExport(FIXTURE_DIR)) === JSON.stringify(syntheticGymExport());
if (!fixtureIsSynthetic) {
  throw new Error(
    'Gym fixtures differ from the synthetic generator. Regenerate fictional fixtures before running importer tests.'
  );
}

describe('synthetic fixture privacy guard', () => {
  const data = loadExport(FIXTURE_DIR);

  it('matches the independently authored generator exactly', () => {
    // Boolean comparison avoids printing potentially private replacement rows
    // into CI logs if someone accidentally copies a real export here.
    expect(JSON.stringify(data) === JSON.stringify(syntheticGymExport())).toBe(true);
  });

  it('uses fictional IDs/dates and contains no source URLs or contact addresses', () => {
    const rows = [...data.sessions, ...data.exerciseLog, ...data.checkins];
    expect(rows.every((r) => /^synthetic-(session|exercise|checkin)-\d+$/.test(r.notionId))).toBe(
      true
    );
    expect(new Set(rows.map((r) => r.notionId)).size).toBe(rows.length);
    expect(rows.every((r) => /^2000-01-\d{2}T/.test(r.createdTime))).toBe(true);
    expect(rows.every((r) => r.Date?.start?.startsWith('2000-01-'))).toBe(true);
    expect(rows.every((r) => !('notionUrl' in r))).toBe(true);
    expect(
      /https?:\/\/|notion\.(so|site)|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(JSON.stringify(data))
    ).toBe(false);
    expect(data.sessions.every((r) => r.Notes?.startsWith('Synthetic case:'))).toBe(true);
    expect(data.exerciseLog.every((r) => r.Notes?.startsWith('Synthetic case:'))).toBe(true);
    expect(
      data.checkins.every((r) => r.Working === null || r.Working.startsWith('Synthetic case:'))
    ).toBe(true);
    expect(
      data.checkins.every(
        (r) => r['Not working'] === null || r['Not working'].startsWith('Synthetic case:')
      )
    ).toBe(true);
  });

  it('keeps every relation within the fictional dataset', () => {
    const sessions = new Map(data.sessions.map((r) => [r.notionId, r]));
    const entries = new Map(data.exerciseLog.map((r) => [r.notionId, r]));
    const weeks = new Set(data.checkins.map((r) => r.notionId));
    expect(data.sessions.every((s) => s.Week.every((id) => weeks.has(id)))).toBe(true);
    expect(
      data.sessions.every((s) =>
        s['Exercise log'].every((id) => entries.get(id)?.['Workout session'].includes(s.notionId))
      )
    ).toBe(true);
    expect(
      data.exerciseLog.every(
        (r) =>
          r['Workout session'].length === 1 && r['Workout session'].every((id) => sessions.has(id))
      )
    ).toBe(true);
    expect(data.checkins.every((r) => new Date(r.Date!.start!).getUTCDay() === 1)).toBe(true);
  });
});

describe('sessionTitleToTypeLabel', () => {
  it('maps Day/Cardio titles to type and label', () => {
    expect(sessionTitleToTypeLabel('Day A - 2000-01-06', 'A')).toMatchObject({
      type: 'strength',
      label: 'Day A',
    });
    expect(sessionTitleToTypeLabel('Day B - 2000-01-05', 'B')).toMatchObject({
      type: 'strength',
      label: 'Day B',
    });
    expect(sessionTitleToTypeLabel('Day A - Session 1 (synthetic)', 'A')).toMatchObject({
      type: 'strength',
      label: 'Day A',
      fromFallback: false,
    });
    expect(sessionTitleToTypeLabel('Cardio - 2000-01-08 (synthetic)', 'Cardio')).toMatchObject({
      type: 'cardio',
      label: 'Cardio',
    });
  });
  it('falls back to the Day select, then to type other', () => {
    expect(sessionTitleToTypeLabel('Synthetic strength', 'B')).toMatchObject({
      type: 'strength',
      label: 'Day B',
      fromFallback: true,
    });
    expect(sessionTitleToTypeLabel('Synthetic walk', 'Cardio')).toMatchObject({
      type: 'cardio',
      label: 'Cardio',
      fromFallback: true,
    });
    expect(sessionTitleToTypeLabel('Synthetic activity', null)).toMatchObject({
      type: 'other',
      label: 'Synthetic activity',
    });
  });
});

describe('parseEnergy / notionDateToIso', () => {
  it('parses energy selects and rejects missing or unnumbered labels', () => {
    expect(parseEnergy('3 - moderate')).toBe(3);
    expect(parseEnergy('1 - low')).toBe(1);
    expect(parseEnergy('5 - high')).toBe(5);
    expect(parseEnergy(null)).toBeNull();
    expect(parseEnergy('high')).toBeNull();
  });
  it('preserves UTC instants, date-only starts and creation-time fallback', () => {
    expect(
      notionDateToIso({ start: '2000-01-06T18:00:00.000Z', end: null, is_datetime: true }, '')
    ).toBe('2000-01-06T18:00:00.000Z');
    expect(notionDateToIso({ start: '2000-01-03', end: null, is_datetime: false }, '')).toBe(
      '2000-01-03T00:00:00.000Z'
    );
    expect(notionDateToIso(null, '2000-01-04 19:00:00Z')).toBe('2000-01-04T19:00:00.000Z');
  });
});

describe('mapExerciseName', () => {
  it('maps the explicit alias table', () => {
    const aliases = [
      ['Lateral raises (machine)', 'Pin-stack', 'Lateral raises'],
      ['Lateral raises', null, 'Lateral raises'],
      ['Iso-lateral high row (Hammer Strength)', 'Hammer high', 'Chest-supported row'],
      ['Iso-lateral high row', null, 'Chest-supported row'],
      ['Iso-lateral low row (Hammer Strength)', 'Hammer low', 'Chest-supported row (Hammer low)'],
      ['Triceps', null, 'Triceps pressdown'],
      ['Tricep extension', null, 'Triceps pressdown'],
      ['Triceps pressdown', 'Machine', 'Triceps pressdown'],
      ['Calf raise', null, 'Calf raise'],
      ['Decline chest press', 'Machine', 'Decline chest press'],
    ] as const;
    for (const [name, variant, expected] of aliases)
      expect(mapExerciseName(name, variant).name).toBe(expected);
    expect(mapExerciseName('Plank', null)).toMatchObject({ name: 'Plank', mode: 'time' });
  });
  it('routes same-title variants separately', () => {
    expect(mapExerciseName('Leg curl', 'Prone').name).toBe('Leg curl');
    expect(mapExerciseName('Leg curl', 'Hoist seated').name).toBe('Leg curl (seated)');
    expect(mapExerciseName('Overhead press', 'Machine').name).toBe('Overhead press');
    expect(mapExerciseName('Overhead press', 'Iso-lateral').name).toBe(
      'Overhead press (iso-lateral)'
    );
  });
  it('passes unknown names through for unreviewed auto-create', () => {
    expect(mapExerciseName('Synthetic exercise', null)).toMatchObject({
      name: 'Synthetic exercise',
      mapped: false,
      mode: 'weight',
    });
  });
});

describe('normalizeSetString / parseAllSets', () => {
  it('handles inline and parenthesized warmups', () => {
    for (const raw of ['80x8 warmup / 150x8 / 150x6', '80x8 (warmup) / 150x8 / 150x6']) {
      expect(parseAllSets(raw).sets).toEqual([
        { weight: 80, reps: 8, warmup: true },
        { weight: 150, reps: 8 },
        { weight: 150, reps: 6 },
      ]);
    }
  });
  it('handles commas with and without warmups', () => {
    expect(parseAllSets('30x8, 30x8, 30x6').sets).toHaveLength(3);
    expect(parseAllSets('10x8 (warmup), 30x8, 30x6').sets).toEqual([
      { weight: 10, reps: 8, warmup: true },
      { weight: 30, reps: 8 },
      { weight: 30, reps: 6 },
    ]);
  });
  it('strips a trailing annotation and retains per-arm hints', () => {
    expect(parseAllSets('10x8 / 20x8 / 30x8 (synthetic ramp)').sets).toEqual([
      { weight: 10, reps: 8 },
      { weight: 20, reps: 8 },
      { weight: 30, reps: 8 },
    ]);
    expect(parseAllSets('25x8 / 25x8 (synthetic per arm)').sets).toEqual([
      { weight: 25, reps: 8, perSide: true },
      { weight: 25, reps: 8, perSide: true },
    ]);
    expect(parseAllSets('120x8, 140x8, 160x1 (failed)').sets).toEqual([
      { weight: 120, reps: 8 },
      { weight: 140, reps: 8 },
      { weight: 160, reps: 1 },
    ]);
  });
  it('handles per-arm tokens, timed sets and a multiplier', () => {
    expect(parseAllSets('25/arm x8 / 25/arm x8').sets).toEqual([
      { weight: 25, reps: 8, perSide: true },
      { weight: 25, reps: 8, perSide: true },
    ]);
    expect(parseAllSets('25 sec').sets).toEqual([{ seconds: 25 }]);
    expect(parseAllSets('20s / 25s / 30s').sets).toEqual([
      { seconds: 20 },
      { seconds: 25 },
      { seconds: 30 },
    ]);
    expect(parseAllSets('22.5x8 x3').sets).toEqual(
      Array.from({ length: 3 }, () => ({ weight: 22.5, reps: 8 }))
    );
  });
  it('returns no partial sets on failure', () => {
    expect(parseAllSets('synthetic invalid token / 20x8')).toEqual({
      sets: [],
      unparsed: ['synthetic invalid token'],
    });
    expect(parseAllSets(null)).toEqual({ sets: [], unparsed: [] });
  });
  it('reports the per-side normalization hint', () => {
    expect(normalizeSetString('25x8 / 25x8 (per arm)')).toEqual({
      normalized: '25x8 / 25x8',
      perSideHint: true,
    });
  });
});

describe('parseCardioNotes', () => {
  it('extracts metrics from fictional notes', () => {
    expect(
      parseCardioNotes(
        'Synthetic: Treadmill, 34:20, 1.4 mi, avg speed 2.5 mph, avg HR 108 bpm, 190 Cal, avg cadence 92 spm, 3200 steps. Ignore the fictional target HR range 120-130.'
      )
    ).toEqual({ durationMin: 34, avgHr: 108, calories: 190, steps: 3200, machine: 'Treadmill' });
  });
  it('handles h:mm:ss, reversed HR labels, thousands separators and watch steps', () => {
    expect(
      parseCardioNotes('Synthetic: Treadmill, 1:04:40, avg HR 112 bpm, 260 Cal, 5,100 watch steps.')
    ).toEqual({ durationMin: 65, avgHr: 112, calories: 260, steps: 5100, machine: 'Treadmill' });
    expect(
      parseCardioNotes('Synthetic: Walking, 21:10, 2300 steps, 125 cal, 105 bpm avg HR.')
    ).toEqual({ durationMin: 21, avgHr: 105, calories: 125, steps: 2300 });
    expect(
      parseCardioNotes('Synthetic: Incline walk, 1.2 mi, avg HR 116 bpm, 180 cal, 2,400 steps.')
    ).toEqual({ avgHr: 116, calories: 180, steps: 2400 });
  });
  it('leaves machine unset without an unambiguous machine word', () => {
    expect(parseCardioNotes('Synthetic: walk, avg HR 106 bpm.').machine).toBeUndefined();
    expect(parseCardioNotes(null)).toEqual({});
  });
});

describe('buildPlan (independently synthetic fixtures)', () => {
  const data = loadExport(FIXTURE_DIR);
  const plan = buildPlan(data);
  it('plans all rows in relation-array order, then back-link order', () => {
    expect(plan.sessions).toHaveLength(4);
    expect(plan.sessions.reduce((n, s) => n + s.entries.length, 0)).toBe(11);
    const session = plan.sessions.find((s) => s.notionId === 'synthetic-session-2')!;
    expect(session.entries.map((e) => e.exerciseName)).toEqual([
      'Leg press',
      'Triceps pressdown',
      'Plank',
      'Face pulls',
    ]);
    expect(session.entries.map((e) => e.orderedByFallback)).toEqual([false, false, false, true]);
    expect(plan.report.fallbackOrdered).toHaveLength(1);
    expect(session.entries[3].sets).toHaveLength(3);
    expect(session.entries[2].sets).toEqual([{ seconds: 25 }]);
  });
  it('preserves instants and energy while preferring the explicit cardio duration', () => {
    expect(plan.sessions[0]).toMatchObject({
      startedAt: '2000-01-06T18:00:00.000Z',
      type: 'strength',
      label: 'Day A',
      energy: 3,
    });
    const cardio = plan.sessions.find((s) => s.type === 'cardio')!;
    expect(cardio).toMatchObject({
      label: 'Cardio',
      durationMin: 36,
      avgHr: 108,
      calories: 190,
      steps: 3200,
      machine: 'Treadmill',
    });
    expect(cardio.notes).toBe(data.sessions[3].Notes);
  });
  it('preserves raw sets and per-arm flags', () => {
    const row = plan.sessions[0].entries.find((e) => e.exerciseName === 'Chest-supported row')!;
    expect(row.rawSets).toBe('25/arm x8 / 25/arm x8 / 25/arm x8');
    expect(row.sets).toHaveLength(3);
    expect(row.sets.every((s) => s.perSide)).toBe(true);
  });
  it('reports the intentional weight mismatch without losing valid records', () => {
    expect(plan.report.weightMismatches).toEqual([
      {
        session: 'Day A - 2000-01-03 (synthetic)',
        exercise: 'Leg press',
        derived: 160,
        notion: 140,
      },
    ]);
    expect(plan.report.parseFailures).toEqual([]);
    expect(plan.report.unmappedExercises).toEqual([]);
    expect(plan.report.orphanEntries).toEqual([]);
    expect(plan.report.missingRelationIds).toEqual([]);
  });
  it('imports a populated week, skips a skeleton, and dates vitals to Monday', () => {
    expect(plan.checkins).toHaveLength(2);
    const filled = plan.checkins[0];
    expect(filled.skipped).toBe(false);
    expect(filled.fields).toEqual({
      daysLogged: 4,
      avgCalories: 2100,
      avgProteinG: 110,
      avgCarbsG: 280,
      avgFatG: 60,
      avgFiberG: 30,
      working: 'Synthetic case: import populated weekly fields.',
      notWorking: 'Synthetic case: preserve this fictional review note.',
    });
    expect(filled.dropped.join(' ')).toContain('Sleep avg');
    expect(plan.checkins[1].skipped).toBe(true);
    expect(plan.report.skippedCheckins).toEqual(['2000-01-10']);
    expect(plan.vitals).toEqual([
      { metricKey: 'neck', value: 14, recordedAt: '2000-01-03', source: 'manual' },
      { metricKey: 'waist', value: 32, recordedAt: '2000-01-03', source: 'manual' },
    ]);
  });
});

describe('parseCliArgs', () => {
  it('parses flags and rejects unknown arguments', () => {
    expect(parseCliArgs(['--dir', 'x', '--user', 'u1', '--dry-run', '--data-dir', 'd'])).toEqual({
      dir: 'x',
      user: 'u1',
      dryRun: true,
      dataDir: 'd',
    });
    expect(() => parseCliArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});

describe('live synthetic import into temp SQLite', () => {
  let ctx: RepoTestDb;
  let mod: typeof import('./import-gym-backfill');
  let data: ExportData;
  beforeEach(async () => {
    ctx = await setupRepoDb('healthtrack-synthetic-gym-');
    mod = await import('./import-gym-backfill');
    insertUser(ctx.sqlite, OWNER);
    data = mod.loadExport(FIXTURE_DIR);
  });
  afterEach(() => ctx?.restore());

  it('imports the fictional dataset end-to-end and verifies stored values', async () => {
    const plan = mod.buildPlan(data);
    const result = await mod.executePlan(plan, OWNER);
    expect(result).toMatchObject({
      seedsCreated: EXERCISE_SEEDS.length,
      seedsSkipped: 0,
      sessionsCreated: 4,
      sessionsDeduped: 0,
      entriesImported: 11,
      checkinsUpserted: 1,
      checkinsSkipped: 1,
      vitalsWritten: 2,
    });
    const entryNames = ctx.sqlite
      .prepare('select e.name from exercise_entries ee join exercises e on e.id = ee.exercise_id')
      .all() as { name: string }[];
    expect(entryNames.filter((r) => r.name === 'Triceps pressdown')).toHaveLength(2);
    expect(entryNames.filter((r) => r.name === 'Leg press')).toHaveLength(3);
    const plank = ctx.sqlite
      .prepare(
        "select ee.sets, ee.raw_sets from exercise_entries ee join exercises e on e.id = ee.exercise_id where e.name = 'Plank' and ee.raw_sets = '25 sec'"
      )
      .get() as { sets: string; raw_sets: string };
    expect(JSON.parse(plank.sets)).toEqual([{ seconds: 25 }]);
    const started = ctx.sqlite
      .prepare('select started_at from workout_sessions order by started_at desc limit 1')
      .get() as { started_at: string };
    expect(started.started_at).toBe('2000-01-08T10:00:00.000Z');
    const cardio = ctx.sqlite
      .prepare(
        "select duration_min, avg_hr, calories, steps, machine, notes from workout_sessions where type = 'cardio'"
      )
      .get();
    expect(cardio).toEqual({
      duration_min: 36,
      avg_hr: 108,
      calories: 190,
      steps: 3200,
      machine: 'Treadmill',
      notes: data.sessions[3].Notes,
    });
    expect(
      ctx.sqlite.prepare('select week_start, days_logged, avg_calories from weekly_checkins').all()
    ).toEqual([{ week_start: '2000-01-03', days_logged: 4, avg_calories: 2100 }]);
    expect(
      ctx.sqlite
        .prepare(
          "select metric_key, value, recorded_at, source from vitals where metric_key in ('neck','waist') order by metric_key"
        )
        .all()
    ).toEqual([
      { metric_key: 'neck', value: 14, recorded_at: '2000-01-03T00:00:00Z', source: 'manual' },
      { metric_key: 'waist', value: 32, recorded_at: '2000-01-03T00:00:00Z', source: 'manual' },
    ]);
    expect((await mod.formatVerification(plan, data, OWNER)).ok).toBe(true);
  });
  it('deduplicates sessions and upserts other records on rerun', async () => {
    const plan = mod.buildPlan(data);
    await mod.executePlan(plan, OWNER);
    expect(await mod.executePlan(plan, OWNER)).toMatchObject({
      seedsCreated: 0,
      seedsSkipped: EXERCISE_SEEDS.length,
      sessionsCreated: 0,
      sessionsDeduped: 4,
      entriesImported: 0,
      checkinsUpserted: 1,
      vitalsWritten: 2,
    });
    expect(
      ctx.sqlite
        .prepare(
          `select
      (select count(*) from workout_sessions) as sessions,
      (select count(*) from exercise_entries) as entries,
      (select count(*) from weekly_checkins) as checkins,
      (select count(*) from vitals) as vitals,
      (select count(*) from exercises) as exercises`
        )
        .get()
    ).toEqual({
      sessions: 4,
      entries: 11,
      checkins: 1,
      vitals: 2,
      exercises: EXERCISE_SEEDS.length,
    });
  });
});
