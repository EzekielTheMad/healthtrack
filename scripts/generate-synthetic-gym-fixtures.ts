/**
 * Hand-authored fictional importer cases, independent of any person's export.
 * Run with Node 22+: node --experimental-strip-types scripts/generate-synthetic-gym-fixtures.ts
 * Do not replace these with anonymized real records. Keep new cases synthetic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ExportData,
  NotionCheckinRow,
  NotionExerciseRow,
  NotionSessionRow,
} from './import-gym-backfill';

export function syntheticGymExport(): ExportData {
  const date = (start: string) => ({ start, end: null, is_datetime: start.includes('T') });
  const sessionId = (n: number) => `synthetic-session-${n}`;
  const exerciseId = (n: number) => `synthetic-exercise-${n}`;
  const checkinId = (n: number) => `synthetic-checkin-${n}`;

  const sessions: NotionSessionRow[] = [
    {
      notionId: sessionId(1),
      createdTime: '2000-01-06T19:00:00.000Z',
      Session: 'Day A - 2000-01-06 (synthetic)',
      Date: date('2000-01-06T18:00:00.000Z'),
      Day: 'A',
      'Duration (min)': null,
      Energy: '3 - moderate',
      Notes: 'Synthetic case: ordinary strength session and per-arm loads.',
      'Exercise log': [1, 2, 3, 4, 5, 6].map(exerciseId),
      Week: [checkinId(1)],
    },
    {
      notionId: sessionId(2),
      createdTime: '2000-01-04T19:00:00.000Z',
      Session: 'Day A - 2000-01-04 (synthetic)',
      Date: date('2000-01-04T18:00:00.000Z'),
      Day: 'A',
      'Duration (min)': 42,
      Energy: '2 - low',
      Notes: 'Synthetic case: warmup, alias, single timed set and back-link-only entry.',
      'Exercise log': [7, 8, 9].map(exerciseId),
      Week: [checkinId(1)],
    },
    {
      notionId: sessionId(3),
      createdTime: '2000-01-03T19:00:00.000Z',
      Session: 'Day A - 2000-01-03 (synthetic)',
      Date: date('2000-01-03T18:00:00.000Z'),
      Day: 'A',
      'Duration (min)': 24,
      Energy: '3 - moderate',
      Notes: 'Synthetic case: intentionally mismatched working weight.',
      'Exercise log': [exerciseId(11)],
      Week: [checkinId(1)],
    },
    {
      notionId: sessionId(4),
      createdTime: '2000-01-08T11:00:00.000Z',
      Session: 'Cardio - 2000-01-08 (synthetic)',
      Date: date('2000-01-08T10:00:00.000Z'),
      Day: 'Cardio',
      'Duration (min)': 36,
      Energy: '3 - moderate',
      Notes: 'Synthetic case: Treadmill, 34:20, avg HR 108 bpm, 190 Cal, 3200 steps.',
      'Exercise log': [],
      Week: [checkinId(1)],
    },
  ];

  const entry = (
    n: number,
    session: number,
    name: string,
    variant: string | null,
    sets: string,
    workingWeight: number | null,
    topReps: number | null
  ): NotionExerciseRow => ({
    notionId: exerciseId(n),
    createdTime: sessions[session - 1].createdTime.replace(
      ':00.000Z',
      `:${String(n).padStart(2, '0')}.000Z`
    ),
    Exercise: name,
    Date: { ...sessions[session - 1].Date! },
    Day: 'A',
    Variant: variant,
    'Working weight (lbs)': workingWeight,
    'Top reps': topReps,
    'All sets': sets,
    Notes: `Synthetic case: exercise entry ${n}.`,
    'Workout session': [sessionId(session)],
  });
  const exerciseLog = [
    entry(1, 1, 'Leg press', null, '160x8 / 160x8 / 160x6', 160, 8),
    entry(2, 1, 'Triceps pressdown', 'Machine', '45x8 / 45x8 / 45x6', 45, 8),
    entry(3, 1, 'Chest-supported row', 'Hammer high', '25/arm x8 / 25/arm x8 / 25/arm x8', 25, 8),
    entry(4, 1, 'Incline DB press (machine)', 'Machine', '65x8 / 65x8 / 65x6', 65, 8),
    entry(5, 1, 'Lateral raises', null, '15x8 / 15x8 / 15x6', 15, 8),
    entry(6, 1, 'Plank', null, '20s / 25s / 30s', null, null),
    entry(7, 2, 'Leg press', null, '80x8 warmup / 150x8 / 150x8 / 150x6', 150, 8),
    entry(8, 2, 'Tricep extension', null, '35x8 / 35x8 / 35x6', 35, 8),
    entry(9, 2, 'Plank', null, '25 sec', null, null),
    entry(10, 2, 'Face pulls', null, '22.5x8 x3', 22.5, 8),
    entry(11, 3, 'Leg press', 'Linear stack', '120x8, 140x8, 160x1 (failed)', 140, 8),
  ];

  const skeleton: NotionCheckinRow = {
    notionId: checkinId(2),
    createdTime: '2000-01-10T09:00:00.000Z',
    'Week of': 'Week of 2000-01-10',
    Date: date('2000-01-10'),
    'Sleep avg': null,
    'Energy avg': null,
    'Hip mobility': false,
    'Days logged': null,
    'Weight (lbs)': null,
    'Waist (in)': null,
    'Neck (in)': null,
    'Avg calories': null,
    'Avg protein (g)': null,
    'Avg carbs (g)': null,
    'Avg fat (g)': null,
    'Avg fiber (g)': null,
    Working: null,
    'Not working': null,
  };
  const checkins: NotionCheckinRow[] = [
    {
      ...skeleton,
      notionId: checkinId(1),
      createdTime: '2000-01-09T09:00:00.000Z',
      'Week of': 'Week of 2000-01-03',
      Date: date('2000-01-03'),
      'Sleep avg': 'Synthetic: steady',
      'Energy avg': 'Synthetic: moderate',
      'Hip mobility': true,
      'Days logged': 4,
      'Waist (in)': 32,
      'Neck (in)': 14,
      'Avg calories': 2100,
      'Avg protein (g)': 110,
      'Avg carbs (g)': 280,
      'Avg fat (g)': 60,
      'Avg fiber (g)': 30,
      Working: 'Synthetic case: import populated weekly fields.',
      'Not working': 'Synthetic case: preserve this fictional review note.',
    },
    skeleton,
  ];
  return { sessions, exerciseLog, checkins, manifest: null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gym-export');
  const { sessions, exerciseLog, checkins } = syntheticGymExport();
  for (const [name, rows] of Object.entries({ sessions, 'exercise-log': exerciseLog, checkins })) {
    fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(rows, null, 2)}\n`);
  }
}
