// @vitest-environment node
/**
 * Notion gym-data importer — pure transform tests over a fixture copied from
 * the real export (scripts/fixtures/gym-export), plus a live end-to-end
 * import against a temp-file SQLite database via the repo test harness.
 *
 * Fixture coverage: warmup strings (inline + parenthesized), per-arm loads,
 * time-based sets ("75s / 75s / 75s" and single "75 sec"), an x3 multiplier
 * (synthetic row — the shape is documented but no x3 string survives in the
 * real export), a cardio session with parseable notes, a filled check-in and
 * a skeleton check-in week.
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
import {
  setupRepoDb,
  insertUser,
  OWNER,
  type RepoTestDb,
} from '../src/lib/repos/repo-test-harness';

const FIXTURE_DIR = path.join(process.cwd(), 'scripts', 'fixtures', 'gym-export');

describe('sessionTitleToTypeLabel', () => {
  it('maps Day/Cardio titles to type + label', () => {
    expect(sessionTitleToTypeLabel('Day A - 2026-07-08', 'A')).toMatchObject({
      type: 'strength',
      label: 'Day A',
    });
    expect(sessionTitleToTypeLabel('Day B - 2026-04-30', 'B')).toMatchObject({
      type: 'strength',
      label: 'Day B',
    });
    expect(
      sessionTitleToTypeLabel('Day A - Session 1 (return to gym)', 'A'),
    ).toMatchObject({ type: 'strength', label: 'Day A', fromFallback: false });
    expect(
      sessionTitleToTypeLabel('Cardio - 2026-05-14 (post-Day B)', 'Cardio'),
    ).toMatchObject({ type: 'cardio', label: 'Cardio' });
  });

  it('falls back to the Day select, then to type other', () => {
    expect(sessionTitleToTypeLabel('Leg day', 'B')).toMatchObject({
      type: 'strength',
      label: 'Day B',
      fromFallback: true,
    });
    expect(sessionTitleToTypeLabel('Evening walk', 'Cardio')).toMatchObject({
      type: 'cardio',
      label: 'Cardio',
      fromFallback: true,
    });
    expect(sessionTitleToTypeLabel('Something else', null)).toMatchObject({
      type: 'other',
      label: 'Something else',
    });
  });
});

describe('parseEnergy', () => {
  it('parses Notion select labels like "4 - good"', () => {
    expect(parseEnergy('4 - good')).toBe(4);
    expect(parseEnergy('1 - drained')).toBe(1);
    expect(parseEnergy('5 - great')).toBe(5);
    expect(parseEnergy(null)).toBeNull();
    expect(parseEnergy('great')).toBeNull();
  });
});

describe('notionDateToIso', () => {
  it('preserves UTC instants and defaults date-only starts to midnight UTC', () => {
    expect(
      notionDateToIso({ start: '2026-07-09 00:40:00Z', end: null, is_datetime: true }, ''),
    ).toBe('2026-07-09T00:40:00.000Z');
    expect(
      notionDateToIso({ start: '2026-04-30', end: null, is_datetime: false }, ''),
    ).toBe('2026-04-30T00:00:00.000Z');
    expect(notionDateToIso(null, '2026-04-29 17:15:28Z')).toBe('2026-04-29T17:15:28.000Z');
  });
});

describe('mapExerciseName', () => {
  it('maps every drifted string from the explicit table', () => {
    expect(mapExerciseName('Lateral raises (machine)', 'Pin-stack').name).toBe('Lateral raises');
    expect(mapExerciseName('Lateral raises', null).name).toBe('Lateral raises');
    expect(mapExerciseName('Iso-lateral high row (Hammer Strength)', 'Hammer high').name).toBe(
      'Chest-supported row',
    );
    expect(mapExerciseName('Iso-lateral high row', null).name).toBe('Chest-supported row');
    expect(mapExerciseName('Iso-lateral low row (Hammer Strength)', 'Hammer low').name).toBe(
      'Chest-supported row (Hammer low)',
    );
    expect(mapExerciseName('Triceps', null).name).toBe('Triceps pressdown');
    expect(mapExerciseName('Tricep extension', null).name).toBe('Triceps pressdown');
    expect(mapExerciseName('Triceps pressdown', 'Machine').name).toBe('Triceps pressdown');
    expect(mapExerciseName('Calf raise', null).name).toBe('Calf raise');
    expect(mapExerciseName('Decline chest press', 'Machine').name).toBe('Decline chest press');
    expect(mapExerciseName('Plank', null)).toMatchObject({ name: 'Plank', mode: 'time' });
  });

  it('routes same-title machine variants by the Variant select', () => {
    expect(mapExerciseName('Leg curl', 'Prone').name).toBe('Leg curl');
    expect(mapExerciseName('Leg curl', 'Hoist seated').name).toBe('Leg curl (seated)');
    expect(mapExerciseName('Overhead press', 'Machine').name).toBe('Overhead press');
    expect(mapExerciseName('Overhead press', 'Iso-lateral').name).toBe(
      'Overhead press (iso-lateral)',
    );
  });

  it('passes unknown names through for unreviewed auto-create', () => {
    expect(mapExerciseName('Bicep curls', null)).toMatchObject({
      name: 'Bicep curls',
      mapped: false,
      mode: 'weight',
    });
  });
});

describe('normalizeSetString / parseAllSets', () => {
  it('handles inline and parenthesized warmups', () => {
    expect(parseAllSets('200x12 warmup / 330x12 / 330x12 / 330x12').sets).toEqual([
      { weight: 200, reps: 12, warmup: true },
      { weight: 330, reps: 12 },
      { weight: 330, reps: 12 },
      { weight: 330, reps: 12 },
    ]);
    expect(parseAllSets('95x8 (warmup) / 135x8 / 135x8 / 135x8').sets).toEqual([
      { weight: 95, reps: 8, warmup: true },
      { weight: 135, reps: 8 },
      { weight: 135, reps: 8 },
      { weight: 135, reps: 8 },
    ]);
  });

  it('handles comma separators, including with a parenthesized warmup', () => {
    expect(parseAllSets('30x15, 30x15, 30x15').sets).toHaveLength(3);
    expect(parseAllSets('160x8 (warmup), 220x8, 220x8, 250x15').sets).toEqual([
      { weight: 160, reps: 8, warmup: true },
      { weight: 220, reps: 8 },
      { weight: 220, reps: 8 },
      { weight: 250, reps: 15 },
    ]);
  });

  it('strips one trailing annotation and keeps per-arm hints', () => {
    expect(parseAllSets('90x10 / 130x10 / 170x10 (ramp to find working weight)').sets).toEqual([
      { weight: 90, reps: 10 },
      { weight: 130, reps: 10 },
      { weight: 170, reps: 10 },
    ]);
    expect(
      parseAllSets('35x10 / 35x10 / 35x10 (Hammer Strength iso-lateral, per arm)').sets,
    ).toEqual([
      { weight: 35, reps: 10, perSide: true },
      { weight: 35, reps: 10, perSide: true },
      { weight: 35, reps: 10, perSide: true },
    ]);
    expect(parseAllSets('303x10, 333x10, 373x1 (failed)').sets).toEqual([
      { weight: 303, reps: 10 },
      { weight: 333, reps: 10 },
      { weight: 373, reps: 1 },
    ]);
  });

  it('handles per-arm tokens, time-based sets, and the x3 multiplier', () => {
    expect(parseAllSets('50/arm x12 / 50/arm x12 / 50/arm x12').sets).toEqual([
      { weight: 50, reps: 12, perSide: true },
      { weight: 50, reps: 12, perSide: true },
      { weight: 50, reps: 12, perSide: true },
    ]);
    expect(parseAllSets('75 sec').sets).toEqual([{ seconds: 75 }]);
    expect(parseAllSets('60s / 75s / 45s').sets).toEqual([
      { seconds: 60 },
      { seconds: 75 },
      { seconds: 45 },
    ]);
    expect(parseAllSets('47.5x15 x3').sets).toEqual([
      { weight: 47.5, reps: 15 },
      { weight: 47.5, reps: 15 },
      { weight: 47.5, reps: 15 },
    ]);
  });

  it('returns sets: [] with the unparsed tokens on failure (never partial)', () => {
    const result = parseAllSets('felt strong / 330x12');
    expect(result.sets).toEqual([]);
    expect(result.unparsed).toEqual(['felt strong']);
    expect(parseAllSets(null)).toEqual({ sets: [], unparsed: [] });
  });

  it('normalizeSetString reports the per-side hint', () => {
    expect(normalizeSetString('40x12 / 40x12 / 40x12 (per arm)')).toEqual({
      normalized: '40x12 / 40x12 / 40x12',
      perSideHint: true,
    });
  });
});

describe('parseCardioNotes', () => {
  it('extracts duration, avg HR, calories, steps and machine from real notes', () => {
    const notes =
      'Treadmill walk. 42:47, 0.22 mi, avg speed 0.3 mph, avg HR 106 bpm, 222 Cal, avg cadence 12 spm, 543 steps. HR stayed below target zone 2 range of 112-131, so treat as light cardio / active recovery rather than true zone 2.';
    expect(parseCardioNotes(notes)).toEqual({
      durationMin: 43,
      avgHr: 106,
      calories: 222,
      steps: 543,
      machine: 'Treadmill',
    });
  });

  it('handles h:mm:ss durations, "bpm avg HR" order, comma thousands and watch steps', () => {
    const notes =
      'Desk treadmill zone 2 walk at speed 2.0. Duration 1:05:08, avg HR 124 bpm, 334 Cal, 720 watch steps.';
    expect(parseCardioNotes(notes)).toEqual({
      durationMin: 65,
      avgHr: 124,
      calories: 334,
      steps: 720,
      machine: 'Treadmill',
    });
    expect(parseCardioNotes('Walking, 28:24, 539 steps, 142 cal, 103 bpm avg HR.')).toEqual({
      durationMin: 28,
      avgHr: 103,
      calories: 142,
      steps: 539,
    });
    expect(parseCardioNotes('Incline walk, 1.29 mi, avg HR 121 bpm (zone 2), 225 cal, 3,152 steps')).toEqual(
      { avgHr: 121, calories: 225, steps: 3152 },
    );
  });

  it('leaves machine unset when no unambiguous machine word appears', () => {
    expect(parseCardioNotes('Walk, tracked w/ Oura. Avg HR 119 bpm.').machine).toBeUndefined();
    expect(parseCardioNotes(null)).toEqual({});
  });
});

describe('buildPlan (fixture copied from the real export)', () => {
  const data = loadExport(FIXTURE_DIR);
  const plan = buildPlan(data);

  it('plans every session and entry with relation-array ordering', () => {
    expect(plan.sessions).toHaveLength(4);
    expect(plan.sessions.reduce((n, s) => n + s.entries.length, 0)).toBe(11);

    const day622 = plan.sessions.find((s) => s.title === 'Day A - 2026-06-22')!;
    // Relation-array order first, then the back-link-only row by created order.
    expect(day622.entries.map((e) => e.exerciseName)).toEqual([
      'Leg press',
      'Triceps pressdown',
      'Plank',
      'Face pulls',
    ]);
    expect(day622.entries.map((e) => e.orderedByFallback)).toEqual([false, false, false, true]);
    expect(plan.report.fallbackOrdered).toHaveLength(1);
    // The x3 multiplier row expands to three identical sets.
    expect(day622.entries[3].sets).toHaveLength(3);
    // "75 sec" single time-based set.
    expect(day622.entries[2].sets).toEqual([{ seconds: 75 }]);
  });

  it('preserves instants, parses energy, and fills cardio columns from notes', () => {
    const day78 = plan.sessions.find((s) => s.title === 'Day A - 2026-07-08')!;
    expect(day78.startedAt).toBe('2026-07-09T00:40:00.000Z');
    expect(day78).toMatchObject({ type: 'strength', label: 'Day A', energy: 5 });

    const cardio = plan.sessions.find((s) => s.type === 'cardio')!;
    expect(cardio).toMatchObject({
      label: 'Cardio',
      durationMin: 43, // Notion Duration column wins over the notes-derived value
      avgHr: 106,
      calories: 222,
      steps: 543,
      machine: 'Treadmill',
    });
    expect(cardio.notes).toContain('42:47'); // notes stay verbatim
  });

  it('keeps rawSets verbatim and marks per-arm sets', () => {
    const day78 = plan.sessions.find((s) => s.title === 'Day A - 2026-07-08')!;
    const row = day78.entries.find((e) => e.exerciseName === 'Chest-supported row')!;
    expect(row.rawSets).toBe('50/arm x12 / 50/arm x12 / 50/arm x12');
    expect(row.sets.every((s) => s.perSide)).toBe(true);
  });

  it('reports working-weight mismatches (derived wins) without failing', () => {
    expect(plan.report.weightMismatches).toEqual([
      {
        session: 'Day A - 2026-05-23',
        exercise: 'Leg press',
        derived: 373, // the failed 373x1 single beats Notion's 333
        notion: 333,
      },
    ]);
    expect(plan.report.parseFailures).toEqual([]);
    expect(plan.report.unmappedExercises).toEqual([]);
    expect(plan.report.orphanEntries).toEqual([]);
  });

  it('imports the filled check-in, skips the skeleton week, and dates vitals to the Monday', () => {
    expect(plan.checkins).toHaveLength(2);
    const filled = plan.checkins.find((c) => c.weekStart === '2026-05-25')!;
    expect(filled.skipped).toBe(false);
    expect(filled.fields).toMatchObject({
      daysLogged: 7,
      avgCalories: 2003,
      avgProteinG: 166.5,
      avgCarbsG: 211.4,
      avgFatG: 57.8,
      avgFiberG: 23.5,
    });
    expect(filled.fields.working).toContain('Lifts progressing on schedule');
    // Pruned Notion fields are reported, not imported.
    expect(filled.dropped.join(' ')).toContain('Sleep avg');

    const skeleton = plan.checkins.find((c) => c.weekStart === '2026-06-01')!;
    expect(skeleton.skipped).toBe(true);
    expect(plan.report.skippedCheckins).toEqual(['2026-06-01']);

    expect(plan.vitals).toEqual([
      { metricKey: 'neck', value: 17, recordedAt: '2026-05-25', source: 'manual' },
      { metricKey: 'waist', value: 41, recordedAt: '2026-05-25', source: 'manual' },
    ]);
  });
});

describe('parseCliArgs', () => {
  it('parses flags and rejects unknown arguments', () => {
    expect(
      parseCliArgs(['--dir', 'x', '--user', 'u1', '--dry-run', '--data-dir', 'd']),
    ).toEqual({ dir: 'x', user: 'u1', dryRun: true, dataDir: 'd' });
    expect(() => parseCliArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});

describe('live import into temp SQLite (repo harness)', () => {
  let ctx: RepoTestDb;
  let mod: typeof import('./import-gym-backfill');
  let data: ExportData;

  beforeEach(async () => {
    ctx = await setupRepoDb('healthtrack-gym-import-');
    // Import AFTER the temp DATA_DIR is set so the module binds the temp DB.
    mod = await import('./import-gym-backfill');
    insertUser(ctx.sqlite, OWNER);
    data = mod.loadExport(FIXTURE_DIR);
  });

  afterEach(() => ctx.restore());

  it('imports the fixture end-to-end and verifies counts', async () => {
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

    // Alias-driven resolution: "Tricep extension" landed on Triceps pressdown.
    const entryNames = ctx.sqlite
      .prepare(
        `select e.name, ee.raw_sets from exercise_entries ee
         join exercises e on e.id = ee.exercise_id
         order by e.name, ee.raw_sets`,
      )
      .all() as { name: string; raw_sets: string }[];
    expect(entryNames.filter((r) => r.name === 'Triceps pressdown')).toHaveLength(2);
    expect(entryNames.filter((r) => r.name === 'Leg press')).toHaveLength(3);

    // Sets survived as structured JSON with the raw string verbatim.
    const plank = ctx.sqlite
      .prepare(
        `select ee.sets, ee.raw_sets from exercise_entries ee
         join exercises e on e.id = ee.exercise_id
         where e.name = 'Plank' and ee.raw_sets = '75 sec'`,
      )
      .get() as { sets: string; raw_sets: string };
    expect(JSON.parse(plank.sets)).toEqual([{ seconds: 75 }]);

    // Session instants preserved (UTC, not shifted).
    const started = ctx.sqlite
      .prepare('select started_at from workout_sessions order by started_at desc limit 1')
      .get() as { started_at: string };
    expect(started.started_at).toBe('2026-07-09T00:40:00.000Z');

    // Cardio columns extracted from notes; notes verbatim.
    const cardio = ctx.sqlite
      .prepare(
        "select duration_min, avg_hr, calories, steps, machine, notes from workout_sessions where type = 'cardio'",
      )
      .get() as {
      duration_min: number;
      avg_hr: number;
      calories: number;
      steps: number;
      machine: string;
      notes: string;
    };
    expect(cardio).toMatchObject({
      duration_min: 43,
      avg_hr: 106,
      calories: 222,
      steps: 543,
      machine: 'Treadmill',
    });
    expect(cardio.notes).toContain('42:47');

    // Check-in row + Monday-dated neck/waist vitals.
    const checkins = ctx.sqlite
      .prepare('select week_start, days_logged, avg_calories from weekly_checkins')
      .all() as { week_start: string; days_logged: number; avg_calories: number }[];
    expect(checkins).toEqual([
      { week_start: '2026-05-25', days_logged: 7, avg_calories: 2003 },
    ]);
    const vitalRows = ctx.sqlite
      .prepare(
        "select metric_key, value, recorded_at, source from vitals where metric_key in ('neck','waist') order by metric_key",
      )
      .all() as { metric_key: string; value: number; recorded_at: string; source: string }[];
    expect(vitalRows).toEqual([
      { metric_key: 'neck', value: 17, recorded_at: '2026-05-25T00:00:00Z', source: 'manual' },
      { metric_key: 'waist', value: 41, recorded_at: '2026-05-25T00:00:00Z', source: 'manual' },
    ]);

    // Verification block agrees with the plan and fixture counts.
    const verification = await mod.formatVerification(plan, data, OWNER);
    expect(verification.ok).toBe(true);
  });

  it('is idempotent: a re-run dedupes sessions and upserts the rest', async () => {
    const plan = mod.buildPlan(data);
    await mod.executePlan(plan, OWNER);
    const second = await mod.executePlan(plan, OWNER);
    expect(second).toMatchObject({
      seedsCreated: 0,
      seedsSkipped: EXERCISE_SEEDS.length,
      sessionsCreated: 0,
      sessionsDeduped: 4,
      entriesImported: 0,
      checkinsUpserted: 1, // PUT-style upsert onto the same row
      vitalsWritten: 2, // (metric, day, source) upsert
    });

    const counts = ctx.sqlite
      .prepare(
        `select
           (select count(*) from workout_sessions) as sessions,
           (select count(*) from exercise_entries) as entries,
           (select count(*) from weekly_checkins) as checkins,
           (select count(*) from vitals) as vitals,
           (select count(*) from exercises) as exercises`,
      )
      .get() as Record<string, number>;
    expect(counts).toEqual({
      sessions: 4,
      entries: 11,
      checkins: 1,
      vitals: 2,
      exercises: EXERCISE_SEEDS.length,
    });
  });
});
