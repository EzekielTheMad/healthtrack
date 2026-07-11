/**
 * Notion Gym Tracker backfill importer — one-shot migration per the fitness
 * domain design spec §Migration
 * (fitness domain design spec).
 *
 * Reads the scratchpad JSON export produced from the Notion databases
 * (sessions.json / exercise-log.json / checkins.json / manifest.json — flat
 * objects with the exact Notion property names) and imports:
 *   - the exercise catalog seed (canonical names from the Gym Training
 *     Reference with the observed drifted Notion strings as aliases),
 *   - 30 workout sessions (title → type/label, UTC instants preserved),
 *   - 94 exercise entries (parseSets over "All sets", raw string verbatim),
 *   - weekly check-ins (manual fields only; neck/waist written through to
 *     vitals dated to the week's Monday).
 *
 * Usage:
 *   DATA_DIR=./data npx tsx scripts/import-gym-backfill.ts \
 *     --dir <export-dir> --user <better-auth user id> [--dry-run]
 *
 * --dry-run builds and prints the full plan (mapping table, per-session
 * summary, parse failures, working-weight mismatches, check-in skips) without
 * touching any database — no --user needed.
 *
 * Idempotent: sessions dedupe on (user, started_at) via the workouts repo
 * (created:false → counted as "already present"), check-ins upsert by
 * week_start, vitals upsert on (metric, day, source), catalog seeds are
 * skipped when their canonical name already resolves.
 */
import fs from 'fs';
import path from 'path';
import { eq, and, inArray } from 'drizzle-orm';
import { pathToFileURL } from 'url';
import { parseSets, type ParsedSet } from '../src/lib/fitness/set-parser';
import { deriveEntryStats, createWorkout, listWorkouts } from '../src/lib/repos/workouts';
import { createExercise, listExercises } from '../src/lib/repos/exercises';
import { upsertCheckin, listCheckins } from '../src/lib/repos/checkins';
import { upsertOwnVital } from '../src/lib/repos/vitals';
import { validateWeekStart } from '../src/lib/repos/_fitness';
import { db } from '../src/db';
import { user, vitals } from '../src/db/schema';

// ---------------------------------------------------------------------------
// Notion export row shapes (exact property names from the export files)
// ---------------------------------------------------------------------------

export interface NotionDate {
  start: string | null;
  end: string | null;
  is_datetime: boolean;
}

export interface NotionSessionRow {
  notionId: string;
  createdTime: string;
  Session: string;
  Date: NotionDate | null;
  Day: string | null;
  'Duration (min)': number | null;
  Energy: string | null;
  Notes: string | null;
  'Exercise log': string[];
  Week: string[];
}

export interface NotionExerciseRow {
  notionId: string;
  createdTime: string;
  Exercise: string;
  Date: NotionDate | null;
  Day: string | null;
  Variant: string | null;
  'Working weight (lbs)': number | null;
  'Top reps': number | null;
  'All sets': string | null;
  Notes: string | null;
  'Workout session': string[];
}

export interface NotionCheckinRow {
  notionId: string;
  createdTime: string;
  'Week of': string;
  Date: NotionDate | null;
  'Sleep avg': string | null;
  'Energy avg': string | null;
  'Hip mobility': boolean;
  'Days logged': number | null;
  'Weight (lbs)': number | null;
  'Waist (in)': number | null;
  'Neck (in)': number | null;
  'Avg calories': number | null;
  'Avg protein (g)': number | null;
  'Avg carbs (g)': number | null;
  'Avg fat (g)': number | null;
  'Avg fiber (g)': number | null;
  Working: string | null;
  'Not working': string | null;
}

export interface ExportData {
  sessions: NotionSessionRow[];
  exerciseLog: NotionExerciseRow[];
  checkins: NotionCheckinRow[];
  manifest: { files?: Record<string, { rows?: number }> } | null;
}

export function loadExport(dir: string): ExportData {
  const read = <T>(name: string): T =>
    JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as T;
  let manifest: ExportData['manifest'] = null;
  try {
    manifest = read('manifest.json');
  } catch {
    // manifest is informational only
  }
  return {
    sessions: read('sessions.json'),
    exerciseLog: read('exercise-log.json'),
    checkins: read('checkins.json'),
    manifest,
  };
}

// ---------------------------------------------------------------------------
// Exercise catalog seed + drift mapping
//
// Canonical names come from the Gym Training Reference canonical list (via
// the source-system audit and agent-workflow
// recon doc): Day A — Leg press, Incline DB press (machine), Chest-supported
// row, Lateral raises, Plank, Hanging knee raise; Day B — Romanian deadlift,
// Overhead press, Lat pulldown, Leg curl, Face pulls. "Machine variants =
// separate trend lines (new canonical name, flagged)".
//
// The cardio canonical names (Stairmaster, Bike, Incline walk, Rower) are NOT
// seeded: cardio sessions carry no exercise entries — the machine lives on
// workout_sessions.machine per the schema.
//
// Mapping decisions (one line per observed Notion string; catalog resolution
// is name+aliases and names must be unique per user, so same-movement machine
// variants that need separate trend lines get a disambiguated canonical name):
//   Leg press                              → Leg press (linear-stack and
//     plate-loaded eras kept as ONE trend line — the owner logged both under
//     the same title after the 2026-05-23 machine switch)
//   Incline DB press (machine)             → Incline DB press (machine)
//   Chest-supported row                    → Chest-supported row [Hammer high]
//   Iso-lateral high row (Hammer Strength) → Chest-supported row (alias)
//   Iso-lateral high row                   → Chest-supported row (alias)
//   Iso-lateral low row (Hammer Strength)  → Chest-supported row (Hammer low)
//     — the spec maps it to "Chest-supported row [variant Hammer low]", but
//     two catalog rows cannot share the name "Chest-supported row"
//     (resolution-uniqueness), so the low-row trend gets a suffixed name.
//   Lateral raises / Lateral raises (machine) → Lateral raises [Pin-stack]
//     (explicit spec mapping; dumbbell + pin-stack + handle-grip eras fold
//     into one trend line)
//   Plank                                  → Plank (mode=time)
//   Romanian deadlift                      → Romanian deadlift (alias RDL)
//   Overhead press [Variant=Machine]       → Overhead press [Machine]
//   Overhead press [Variant=Iso-lateral]   → Overhead press (iso-lateral)
//     — per-arm Hammer iso press is a separate trend (35-40/arm vs 65-70
//     stack); routed by the row's Variant select, judgment call documented.
//   Lat pulldown                           → Lat pulldown
//   Leg curl [Variant=Prone]               → Leg curl [Prone]
//   Leg curl [Variant=Hoist seated]        → Leg curl (seated) [Hoist seated]
//     — owner's own notes: "Track separately from prone leg curl numbers".
//   Face pulls                             → Face pulls
//   Triceps / Tricep extension / Triceps pressdown → Triceps pressdown [Machine]
//   Calf raise                             → Calf raise
//   Decline chest press                    → Decline chest press [Machine],
//     reviewStatus unreviewed (one-off incline substitution)
// ---------------------------------------------------------------------------

export interface ExerciseSeed {
  name: string;
  variant: string | null;
  mode: 'weight' | 'time';
  aliases: string[];
  reviewStatus: 'confirmed' | 'unreviewed';
}

export const EXERCISE_SEEDS: ExerciseSeed[] = [
  { name: 'Leg press', variant: null, mode: 'weight', aliases: [], reviewStatus: 'confirmed' },
  { name: 'Incline DB press (machine)', variant: 'Machine', mode: 'weight', aliases: [], reviewStatus: 'confirmed' },
  {
    name: 'Chest-supported row',
    variant: 'Hammer high',
    mode: 'weight',
    aliases: ['Iso-lateral high row (Hammer Strength)', 'Iso-lateral high row'],
    reviewStatus: 'confirmed',
  },
  {
    name: 'Chest-supported row (Hammer low)',
    variant: 'Hammer low',
    mode: 'weight',
    aliases: ['Iso-lateral low row (Hammer Strength)'],
    reviewStatus: 'confirmed',
  },
  {
    name: 'Lateral raises',
    variant: 'Pin-stack',
    mode: 'weight',
    aliases: ['Lateral raises (machine)'],
    reviewStatus: 'confirmed',
  },
  { name: 'Plank', variant: null, mode: 'time', aliases: [], reviewStatus: 'confirmed' },
  { name: 'Hanging knee raise', variant: null, mode: 'weight', aliases: [], reviewStatus: 'confirmed' },
  { name: 'Romanian deadlift', variant: null, mode: 'weight', aliases: ['RDL'], reviewStatus: 'confirmed' },
  { name: 'Overhead press', variant: 'Machine', mode: 'weight', aliases: ['OHP'], reviewStatus: 'confirmed' },
  {
    name: 'Overhead press (iso-lateral)',
    variant: 'Iso-lateral',
    mode: 'weight',
    aliases: ['Iso-lateral shoulder press'],
    reviewStatus: 'confirmed',
  },
  { name: 'Lat pulldown', variant: null, mode: 'weight', aliases: [], reviewStatus: 'confirmed' },
  { name: 'Leg curl', variant: 'Prone', mode: 'weight', aliases: [], reviewStatus: 'confirmed' },
  {
    name: 'Leg curl (seated)',
    variant: 'Hoist seated',
    mode: 'weight',
    aliases: ['Seated leg curl'],
    reviewStatus: 'confirmed',
  },
  { name: 'Face pulls', variant: null, mode: 'weight', aliases: [], reviewStatus: 'confirmed' },
  {
    name: 'Triceps pressdown',
    variant: 'Machine',
    mode: 'weight',
    aliases: ['Triceps', 'Tricep extension'],
    reviewStatus: 'confirmed',
  },
  { name: 'Calf raise', variant: null, mode: 'weight', aliases: [], reviewStatus: 'confirmed' },
  {
    name: 'Decline chest press',
    variant: 'Machine',
    mode: 'weight',
    aliases: [],
    reviewStatus: 'unreviewed',
  },
];

/** Rows that must be routed by the Notion Variant select — name resolution
 *  alone cannot split same-title rows into separate trend lines. */
const VARIANT_ROUTES = new Map<string, string>([
  ['leg curl||hoist seated', 'Leg curl (seated)'],
  ['overhead press||iso-lateral', 'Overhead press (iso-lateral)'],
]);

const aliasIndex = new Map<string, ExerciseSeed>();
for (const seed of EXERCISE_SEEDS) {
  for (const key of [seed.name, ...seed.aliases]) {
    aliasIndex.set(key.trim().toLowerCase(), seed);
  }
}

export interface MappedExercise {
  /** Canonical name passed as exercise_name (resolves via the seeded catalog). */
  name: string;
  mode: 'weight' | 'time';
  /** false = no seed covers this string; it will auto-create `unreviewed`. */
  mapped: boolean;
}

export function mapExerciseName(exercise: string, variant: string | null): MappedExercise {
  const routed = VARIANT_ROUTES.get(
    `${exercise.trim().toLowerCase()}||${(variant ?? '').trim().toLowerCase()}`,
  );
  if (routed) {
    const seed = aliasIndex.get(routed.toLowerCase());
    if (seed) return { name: seed.name, mode: seed.mode, mapped: true };
  }
  const seed = aliasIndex.get(exercise.trim().toLowerCase());
  if (seed) return { name: seed.name, mode: seed.mode, mapped: true };
  return { name: exercise.trim(), mode: 'weight', mapped: false };
}

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

/** "Day A - 2026-07-08" → strength/"Day A"; "Cardio - …" → cardio/"Cardio". */
export function sessionTitleToTypeLabel(
  title: string,
  daySelect: string | null,
): { type: 'strength' | 'cardio' | 'other'; label: string; fromFallback: boolean } {
  const day = /^Day\s+([ABC])\b/i.exec(title);
  if (day) return { type: 'strength', label: `Day ${day[1].toUpperCase()}`, fromFallback: false };
  if (/^Cardio\b/i.test(title)) return { type: 'cardio', label: 'Cardio', fromFallback: false };
  if (daySelect === 'Cardio') return { type: 'cardio', label: 'Cardio', fromFallback: true };
  if (daySelect && /^[ABC]$/.test(daySelect)) {
    return { type: 'strength', label: `Day ${daySelect}`, fromFallback: true };
  }
  return { type: 'other', label: title, fromFallback: true };
}

/** Notion select "4 - good" → 4. */
export function parseEnergy(select: string | null): number | null {
  if (!select) return null;
  const m = /^\s*([1-5])\s*-/.exec(select);
  return m ? Number(m[1]) : null;
}

/** Notion date {start} → ISO UTC instant. Notion stores UTC; instants are
 *  preserved (never shifted). Date-only starts become midnight UTC. */
export function notionDateToIso(date: NotionDate | null, fallback: string): string {
  const raw = date?.start ?? fallback;
  const ts = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(ts.getTime())) {
    throw new Error(`Unparseable Notion date '${raw}'`);
  }
  return ts.toISOString();
}

/**
 * Importer-side normalization in front of parseSets — rawSets stays verbatim,
 * only the parse INPUT is cleaned:
 *   - "(warmup)" → " warmup" (the parser's inline warmup flag)
 *   - one trailing parenthetical annotation is stripped ("(ramp to find
 *     working weight)", "(Hoist seated/sliding-seat machine)", "(failed)", …);
 *     if it mentions a per-arm/side load, every parsed set gets perSide:true
 *   - comma separators become the parser's " / " separator
 */
export function normalizeSetString(raw: string): { normalized: string; perSideHint: boolean } {
  let s = raw.trim();
  let perSideHint = false;
  s = s.replace(/\(\s*warm-?up\s*\)/gi, ' warmup');
  const trailing = /\s*\(([^()]*)\)\s*$/.exec(s);
  if (trailing) {
    if (/per\s*[- ]?(arm|side|leg|hand)/i.test(trailing[1])) perSideHint = true;
    s = s.slice(0, trailing.index);
  }
  s = s.replace(/\s*,\s*/g, ' / ');
  return { normalized: s.trim(), perSideHint };
}

export interface ParsedEntrySets {
  sets: ParsedSet[];
  unparsed: string[];
}

/** parseSets over the normalized string. Any unparsed token → sets: [] (the
 *  raw string is ground truth; partial parses would corrupt derived stats). */
export function parseAllSets(raw: string | null): ParsedEntrySets {
  if (!raw || raw.trim() === '') return { sets: [], unparsed: [] };
  const { normalized, perSideHint } = normalizeSetString(raw);
  const { sets, unparsed } = parseSets(normalized);
  if (unparsed.length > 0) return { sets: [], unparsed };
  return {
    sets: perSideHint ? sets.map((s) => ({ ...s, perSide: true })) : sets,
    unparsed: [],
  };
}

export interface CardioNotesMetrics {
  durationMin?: number;
  avgHr?: number;
  calories?: number;
  steps?: number;
  machine?: string;
}

/**
 * Extract cardio metrics from free-text session notes where cleanly present.
 * Notes are imported verbatim regardless — this only fills the structured
 * columns. Machine comes from an unambiguous machine word in the notes
 * (Treadmill / Stairmaster / Bike); "active cal" is accepted as calories when
 * it is the only calorie figure.
 */
export function parseCardioNotes(notes: string | null): CardioNotesMetrics {
  const out: CardioNotesMetrics = {};
  if (!notes) return out;

  // Duration "42:47" (mm:ss) or "1:05:08" (h:mm:ss), rounded to the minute.
  const hms = /\b(\d{1,2}):(\d{2}):(\d{2})\b/.exec(notes);
  const ms = /\b(\d{1,3}):(\d{2})\b/.exec(notes);
  if (hms) {
    out.durationMin = Math.round(
      Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3]) / 60,
    );
  } else if (ms) {
    out.durationMin = Math.round(Number(ms[1]) + Number(ms[2]) / 60);
  }

  const avgHr =
    /avg\.?\s*HR\s*:?\s*(\d{2,3}(?:\.\d+)?)/i.exec(notes) ??
    /(\d{2,3}(?:\.\d+)?)\s*bpm\s*avg\.?\s*HR/i.exec(notes);
  if (avgHr) out.avgHr = Number(avgHr[1]);

  const cal = /([\d,]+(?:\.\d+)?)\s*(?:active\s+)?cal(?:ories)?\b/i.exec(notes);
  if (cal) out.calories = Number(cal[1].replace(/,/g, ''));

  const steps = /([\d,]+)\s*(?:watch\s+)?steps\b/i.exec(notes);
  if (steps) out.steps = Number(steps[1].replace(/,/g, ''));

  const machines: string[] = [];
  if (/treadmill/i.test(notes)) machines.push('Treadmill');
  if (/stairmaster/i.test(notes)) machines.push('Stairmaster');
  if (/\bbike\b/i.test(notes)) machines.push('Bike');
  if (machines.length === 1) out.machine = machines[0];

  return out;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface PlanEntry {
  notionId: string;
  sourceName: string;
  sourceVariant: string | null;
  exerciseName: string;
  mapped: boolean;
  sets: ParsedSet[];
  rawSets: string | null;
  notes: string | null;
  /** Order fell back to createdTime (row missing from the session's relation array). */
  orderedByFallback: boolean;
  parseFailure: string[] | null;
  weightMismatch: { derived: number | null; notion: number | null } | null;
}

export interface PlanSession {
  notionId: string;
  title: string;
  startedAt: string;
  type: 'strength' | 'cardio' | 'other';
  label: string;
  durationMin: number | null;
  energy: number | null;
  notes: string | null;
  distanceMi: number | null;
  avgHr: number | null;
  calories: number | null;
  steps: number | null;
  machine: string | null;
  entries: PlanEntry[];
}

export interface PlanCheckinFields {
  working?: string;
  notWorking?: string;
  daysLogged?: number;
  avgCalories?: number;
  avgProteinG?: number;
  avgCarbsG?: number;
  avgFatG?: number;
  avgFiberG?: number;
}

export interface PlanCheckin {
  notionId: string;
  weekStart: string;
  fields: PlanCheckinFields;
  neckIn: number | null;
  waistIn: number | null;
  /** Skeleton week (no manual field at all) — skipped, reported. */
  skipped: boolean;
  /** Fields present in Notion but pruned from the HealthTrack schema. */
  dropped: string[];
}

export interface PlanVital {
  metricKey: 'neck' | 'waist';
  value: number;
  /** The week's Monday (spec: "dated to their week"). */
  recordedAt: string;
  source: 'manual';
}

export interface Plan {
  sessions: PlanSession[];
  checkins: PlanCheckin[];
  vitals: PlanVital[];
  report: {
    parseFailures: { session: string; exercise: string; raw: string; unparsed: string[] }[];
    weightMismatches: {
      session: string;
      exercise: string;
      derived: number | null;
      notion: number | null;
    }[];
    unmappedExercises: string[];
    orphanEntries: { notionId: string; exercise: string }[];
    missingRelationIds: { session: string; id: string }[];
    fallbackOrdered: { session: string; exercise: string }[];
    skippedCheckins: string[];
    droppedCheckinFields: { weekStart: string; fields: string[] }[];
    invalidCheckins: { title: string; reason: string }[];
  };
}

export function buildPlan(data: ExportData): Plan {
  const report: Plan['report'] = {
    parseFailures: [],
    weightMismatches: [],
    unmappedExercises: [],
    orphanEntries: [],
    missingRelationIds: [],
    fallbackOrdered: [],
    skippedCheckins: [],
    droppedCheckinFields: [],
    invalidCheckins: [],
  };

  const byId = new Map(data.exerciseLog.map((r) => [r.notionId, r]));
  const consumed = new Set<string>();

  const buildEntry = (row: NotionExerciseRow, session: PlanSession, fallback: boolean): void => {
    const mapped = mapExerciseName(row.Exercise, row.Variant);
    if (!mapped.mapped && !report.unmappedExercises.includes(row.Exercise)) {
      report.unmappedExercises.push(row.Exercise);
    }
    const raw = row['All sets'];
    const { sets, unparsed } = parseAllSets(raw);
    const entry: PlanEntry = {
      notionId: row.notionId,
      sourceName: row.Exercise,
      sourceVariant: row.Variant,
      exerciseName: mapped.name,
      mapped: mapped.mapped,
      sets,
      rawSets: raw,
      notes: row.Notes,
      orderedByFallback: fallback,
      parseFailure: unparsed.length > 0 ? unparsed : null,
      weightMismatch: null,
    };
    if (unparsed.length > 0) {
      report.parseFailures.push({
        session: session.title,
        exercise: row.Exercise,
        raw: raw ?? '',
        unparsed,
      });
    } else if (sets.length > 0) {
      // Sanity check: derived working weight vs Notion's structured field.
      // Derived wins (the Notion field carried the per-arm ambiguity); every
      // divergence is reported, never fatal.
      const { workingWeight } = deriveEntryStats(mapped.mode, sets);
      const notion = row['Working weight (lbs)'];
      if (mapped.mode === 'weight' && workingWeight !== notion) {
        entry.weightMismatch = { derived: workingWeight, notion };
        report.weightMismatches.push({
          session: session.title,
          exercise: row.Exercise,
          derived: workingWeight,
          notion,
        });
      }
    }
    if (fallback) report.fallbackOrdered.push({ session: session.title, exercise: row.Exercise });
    session.entries.push(entry);
  };

  const sessions: PlanSession[] = data.sessions.map((s) => {
    const { type, label } = sessionTitleToTypeLabel(s.Session, s.Day);
    const notes = s.Notes;
    const cardio = type === 'cardio' ? parseCardioNotes(notes) : {};
    const session: PlanSession = {
      notionId: s.notionId,
      title: s.Session,
      startedAt: notionDateToIso(s.Date, s.createdTime),
      type,
      label,
      durationMin: s['Duration (min)'] ?? cardio.durationMin ?? null,
      energy: parseEnergy(s.Energy),
      notes,
      distanceMi: null,
      avgHr: cardio.avgHr ?? null,
      calories: cardio.calories ?? null,
      steps: cardio.steps ?? null,
      machine: cardio.machine ?? null,
      entries: [],
    };

    // Position = order within the session's relation array …
    for (const id of s['Exercise log']) {
      const row = byId.get(id);
      if (!row) {
        report.missingRelationIds.push({ session: s.Session, id });
        continue;
      }
      consumed.add(id);
      buildEntry(row, session, false);
    }
    // … falling back to created order for rows only linked via the back-link.
    const stragglers = data.exerciseLog
      .filter(
        (r) =>
          !consumed.has(r.notionId) && r['Workout session'].includes(s.notionId),
      )
      .sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    for (const row of stragglers) {
      consumed.add(row.notionId);
      buildEntry(row, session, true);
    }
    return session;
  });

  for (const row of data.exerciseLog) {
    if (!consumed.has(row.notionId)) {
      report.orphanEntries.push({ notionId: row.notionId, exercise: row.Exercise });
    }
  }

  // Check-ins: manual fields only. Sleep avg / Energy avg / Hip mobility were
  // deliberately pruned from the HealthTrack schema (spec decision 5) and are
  // reported as dropped when present. Skeleton weeks (no importable manual
  // field) are skipped and reported.
  const checkins: PlanCheckin[] = [];
  const planVitals: PlanVital[] = [];
  for (const c of data.checkins) {
    const m = /^Week of (\d{4}-\d{2}-\d{2})$/.exec(c['Week of'] ?? '');
    if (!m) {
      report.invalidCheckins.push({
        title: c['Week of'],
        reason: 'title does not match "Week of YYYY-MM-DD"',
      });
      continue;
    }
    let weekStart: string;
    try {
      weekStart = validateWeekStart(m[1]);
    } catch (err) {
      report.invalidCheckins.push({
        title: c['Week of'],
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const fields: PlanCheckinFields = {};
    if (c.Working != null) fields.working = c.Working;
    if (c['Not working'] != null) fields.notWorking = c['Not working'];
    if (c['Days logged'] != null) fields.daysLogged = c['Days logged'];
    if (c['Avg calories'] != null) fields.avgCalories = c['Avg calories'];
    if (c['Avg protein (g)'] != null) fields.avgProteinG = c['Avg protein (g)'];
    if (c['Avg carbs (g)'] != null) fields.avgCarbsG = c['Avg carbs (g)'];
    if (c['Avg fat (g)'] != null) fields.avgFatG = c['Avg fat (g)'];
    if (c['Avg fiber (g)'] != null) fields.avgFiberG = c['Avg fiber (g)'];
    const neckIn = c['Neck (in)'];
    const waistIn = c['Waist (in)'];

    const dropped: string[] = [];
    if (c['Sleep avg'] != null) dropped.push(`Sleep avg (${c['Sleep avg']})`);
    if (c['Energy avg'] != null) dropped.push(`Energy avg (${c['Energy avg']})`);
    if (c['Hip mobility']) dropped.push('Hip mobility (checked)');
    if (c['Weight (lbs)'] != null) dropped.push(`Weight (lbs) (${c['Weight (lbs)']})`);
    if (dropped.length > 0) report.droppedCheckinFields.push({ weekStart, fields: dropped });

    const hasManual =
      Object.keys(fields).length > 0 || neckIn != null || waistIn != null;
    const checkin: PlanCheckin = {
      notionId: c.notionId,
      weekStart,
      fields,
      neckIn: neckIn ?? null,
      waistIn: waistIn ?? null,
      skipped: !hasManual,
      dropped,
    };
    checkins.push(checkin);
    if (!hasManual) {
      report.skippedCheckins.push(weekStart);
      continue;
    }
    // Historical neck/waist → vitals rows dated to the week's Monday (spec:
    // "imported as vitals rows dated to their week"). The live check-in API
    // dates write-throughs to the submission day, which would be wrong for a
    // backfill — so the importer uses the same vitals upsert the check-in
    // repo delegates to, with the Monday as recorded_at.
    if (neckIn != null) {
      planVitals.push({ metricKey: 'neck', value: neckIn, recordedAt: weekStart, source: 'manual' });
    }
    if (waistIn != null) {
      planVitals.push({ metricKey: 'waist', value: waistIn, recordedAt: weekStart, source: 'manual' });
    }
  }

  return { sessions, checkins, vitals: planVitals, report };
}

// ---------------------------------------------------------------------------
// Execution (live import via the fitness repos)
// ---------------------------------------------------------------------------

export interface ExecuteResult {
  seedsCreated: number;
  seedsSkipped: number;
  sessionsCreated: number;
  sessionsDeduped: number;
  entriesImported: number;
  checkinsUpserted: number;
  checkinsSkipped: number;
  vitalsWritten: number;
}

export async function executePlan(
  plan: Plan,
  userId: string,
  log: (line: string) => void = () => {},
): Promise<ExecuteResult> {
  const result: ExecuteResult = {
    seedsCreated: 0,
    seedsSkipped: 0,
    sessionsCreated: 0,
    sessionsDeduped: 0,
    entriesImported: 0,
    checkinsUpserted: 0,
    checkinsSkipped: 0,
    vitalsWritten: 0,
  };

  // 1. Catalog seed — skip any seed whose canonical name already resolves
  //    (idempotent re-run).
  const existing = await listExercises(userId, userId);
  const claimed = new Set(
    existing.flatMap((r) => [r.name, ...r.aliases]).map((k) => k.trim().toLowerCase()),
  );
  for (const seed of EXERCISE_SEEDS) {
    if (claimed.has(seed.name.toLowerCase())) {
      result.seedsSkipped += 1;
      continue;
    }
    await createExercise(userId, userId, seed);
    result.seedsCreated += 1;
  }
  log(`catalog: ${result.seedsCreated} seeded, ${result.seedsSkipped} already present`);

  // 2. Sessions + entries (dedupe on (user, started_at) — created:false means
  //    the session already existed and nothing was written).
  for (const s of plan.sessions) {
    const { created } = await createWorkout(
      userId,
      { ownerId: userId, dependentId: null },
      {
        type: s.type,
        label: s.label,
        startedAt: s.startedAt,
        durationMin: s.durationMin,
        energy: s.energy,
        notes: s.notes,
        avgHr: s.avgHr,
        calories: s.calories,
        steps: s.steps,
        machine: s.machine,
        entries: s.entries.map((e) => ({
          exerciseName: e.exerciseName,
          sets: e.sets,
          rawSets: e.rawSets,
          notes: e.notes,
        })),
      },
    );
    if (created) {
      result.sessionsCreated += 1;
      result.entriesImported += s.entries.length;
    } else {
      result.sessionsDeduped += 1;
      log(`session already present (dedupe): ${s.title} @ ${s.startedAt}`);
    }
  }

  // 3. Check-ins (upsert by week_start) + Monday-dated neck/waist vitals.
  for (const c of plan.checkins) {
    if (c.skipped) {
      result.checkinsSkipped += 1;
      continue;
    }
    await upsertCheckin(userId, userId, c.weekStart, c.fields);
    result.checkinsUpserted += 1;
  }
  for (const v of plan.vitals) {
    upsertOwnVital(db, userId, v);
    result.vitalsWritten += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function planExerciseCounts(plan: Plan): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of plan.sessions) {
    for (const e of s.entries) {
      counts.set(e.exerciseName, (counts.get(e.exerciseName) ?? 0) + 1);
    }
  }
  return counts;
}

export function formatPlan(plan: Plan, opts: { verbose: boolean } = { verbose: false }): string {
  const lines: string[] = [];
  const totalEntries = plan.sessions.reduce((n, s) => n + s.entries.length, 0);
  const importedCheckins = plan.checkins.filter((c) => !c.skipped);

  lines.push('Exercise mapping (observed string [Variant] -> canonical):');
  const seen = new Set<string>();
  for (const s of plan.sessions) {
    for (const e of s.entries) {
      const key = `${e.sourceName}||${e.sourceVariant ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const variant = e.sourceVariant ? ` [${e.sourceVariant}]` : '';
      const flag = e.mapped ? '' : '   (UNMAPPED — will auto-create unreviewed)';
      lines.push(`  ${(e.sourceName + variant).padEnd(48)} -> ${e.exerciseName}${flag}`);
    }
  }

  lines.push('', `Sessions: ${plan.sessions.length} (entries: ${totalEntries})`);
  if (opts.verbose) {
    for (const s of plan.sessions) {
      const cardio =
        s.type === 'cardio'
          ? ` [dur ${s.durationMin ?? '-'}m, hr ${s.avgHr ?? '-'}, cal ${s.calories ?? '-'}, steps ${s.steps ?? '-'}, machine ${s.machine ?? '-'}]`
          : '';
      lines.push(
        `  ${s.startedAt}  ${s.type}/${s.label}  energy ${s.energy ?? '-'}  entries ${s.entries.length}${cardio}`,
      );
      for (const e of s.entries) {
        const marks = [
          e.parseFailure ? 'PARSE-FAIL' : null,
          e.weightMismatch ? 'WT-MISMATCH' : null,
          e.orderedByFallback ? 'fallback-order' : null,
        ]
          .filter(Boolean)
          .join(',');
        lines.push(
          `      ${e.exerciseName.padEnd(32)} sets ${String(e.sets.length).padStart(2)}  raw "${e.rawSets ?? ''}"${marks ? `  <${marks}>` : ''}`,
        );
      }
    }
  }

  lines.push('', 'Per-exercise entry counts:');
  for (const [name, n] of [...planExerciseCounts(plan).entries()].sort()) {
    lines.push(`  ${name.padEnd(36)} ${n}`);
  }

  lines.push(
    '',
    `Check-ins: ${importedCheckins.length} to import, ${plan.report.skippedCheckins.length} skeleton weeks skipped`,
  );
  for (const c of importedCheckins) {
    const parts = [
      ...Object.keys(c.fields),
      c.neckIn != null ? `neck ${c.neckIn}` : null,
      c.waistIn != null ? `waist ${c.waistIn}` : null,
    ].filter(Boolean);
    lines.push(`  ${c.weekStart}: ${parts.join(', ')}`);
  }
  if (plan.report.skippedCheckins.length > 0) {
    lines.push(`  skipped (no manual fields): ${plan.report.skippedCheckins.join(', ')}`);
  }
  lines.push(`Vitals write-through (Monday-dated): ${plan.vitals.length} rows`);
  for (const v of plan.vitals) {
    lines.push(`  ${v.recordedAt}  ${v.metricKey} = ${v.value} in`);
  }

  const r = plan.report;
  lines.push('', `Parse failures: ${r.parseFailures.length}`);
  for (const f of r.parseFailures) {
    lines.push(
      `  ${f.session} / ${f.exercise}: raw "${f.raw}" — unparsed tokens: ${f.unparsed.map((t) => `"${t}"`).join(', ')} (imported with sets: [])`,
    );
  }
  lines.push(`Working-weight mismatches (derived wins): ${r.weightMismatches.length}`);
  for (const m of r.weightMismatches) {
    lines.push(`  ${m.session} / ${m.exercise}: derived ${m.derived} vs Notion ${m.notion}`);
  }
  if (r.unmappedExercises.length > 0) {
    lines.push(`Unmapped exercise strings: ${r.unmappedExercises.join(', ')}`);
  }
  if (r.orphanEntries.length > 0) {
    lines.push(
      `ORPHAN exercise rows (no session — NOT importable): ${r.orphanEntries
        .map((o) => `${o.exercise} (${o.notionId})`)
        .join(', ')}`,
    );
  }
  if (r.missingRelationIds.length > 0) {
    lines.push(
      `Relation ids with no exported row: ${r.missingRelationIds
        .map((x) => `${x.session}:${x.id}`)
        .join(', ')}`,
    );
  }
  if (r.fallbackOrdered.length > 0) {
    lines.push(
      `Entries ordered by createdTime fallback: ${r.fallbackOrdered
        .map((x) => `${x.session}/${x.exercise}`)
        .join(', ')}`,
    );
  }
  if (r.droppedCheckinFields.length > 0) {
    lines.push('Check-in fields present in Notion but pruned from the schema:');
    for (const d of r.droppedCheckinFields) {
      lines.push(`  ${d.weekStart}: ${d.fields.join(', ')}`);
    }
  }
  if (r.invalidCheckins.length > 0) {
    lines.push(
      `Invalid check-in rows: ${r.invalidCheckins.map((c) => `${c.title} (${c.reason})`).join('; ')}`,
    );
  }
  return lines.join('\n');
}

/** Post-import verification: DB counts vs the plan and the export manifest. */
export async function formatVerification(
  plan: Plan,
  data: ExportData,
  userId: string,
): Promise<{ text: string; ok: boolean }> {
  const workouts = await listWorkouts(userId, { ownerId: userId, dependentId: null }, {});
  const dbSessions = workouts.length;
  const dbEntries = workouts.reduce((n, w) => n + w.entries.length, 0);
  const dbCheckins = (await listCheckins(userId, userId)).length;
  const vitalRows = await db
    .select()
    .from(vitals)
    .where(
      and(
        eq(vitals.userId, userId),
        eq(vitals.source, 'manual'),
        inArray(vitals.metricKey, ['neck', 'waist']),
      ),
    );

  const manifest = data.manifest?.files ?? {};
  const expSessions = manifest['sessions.json']?.rows ?? data.sessions.length;
  const expEntries = manifest['exercise-log.json']?.rows ?? data.exerciseLog.length;
  const expCheckinRows = manifest['checkins.json']?.rows ?? data.checkins.length;
  const expectedCheckins = expCheckinRows - plan.report.skippedCheckins.length;
  const planEntries = plan.sessions.reduce((n, s) => n + s.entries.length, 0);

  const dbExerciseCounts = new Map<string, number>();
  for (const w of workouts) {
    for (const e of w.entries) {
      dbExerciseCounts.set(e.exercise.name, (dbExerciseCounts.get(e.exercise.name) ?? 0) + 1);
    }
  }
  const planCounts = planExerciseCounts(plan);

  const checks: { label: string; expected: number; actual: number }[] = [
    { label: 'sessions', expected: expSessions, actual: dbSessions },
    { label: 'entries (manifest)', expected: expEntries, actual: dbEntries },
    { label: 'entries (plan)', expected: planEntries, actual: dbEntries },
    { label: 'check-ins (minus skipped)', expected: expectedCheckins, actual: dbCheckins },
    { label: 'neck/waist vitals', expected: plan.vitals.length, actual: vitalRows.length },
  ];
  let ok = true;
  const lines = ['Verification (DB vs manifest/plan):'];
  for (const c of checks) {
    const pass = c.expected === c.actual;
    ok = ok && pass;
    lines.push(
      `  ${c.label.padEnd(28)} expected ${String(c.expected).padStart(3)}  actual ${String(c.actual).padStart(3)}  ${pass ? 'OK' : 'MISMATCH'}`,
    );
  }
  lines.push('  per-exercise entry counts:');
  const names = new Set([...planCounts.keys(), ...dbExerciseCounts.keys()]);
  for (const name of [...names].sort()) {
    const p = planCounts.get(name) ?? 0;
    const d = dbExerciseCounts.get(name) ?? 0;
    const pass = p === d;
    ok = ok && pass;
    lines.push(
      `    ${name.padEnd(36)} plan ${String(p).padStart(2)}  db ${String(d).padStart(2)}  ${pass ? 'OK' : 'MISMATCH'}`,
    );
  }
  if (plan.report.parseFailures.length > 0) {
    lines.push(
      `  parse failures: ${plan.report.parseFailures.length} entries imported with sets: [] (see plan report)`,
    );
  }
  return { text: lines.join('\n'), ok };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliArgs {
  dir?: string;
  user?: string;
  dataDir?: string;
  dryRun: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') args.dir = argv[++i];
    else if (arg === '--user') args.user = argv[++i];
    else if (arg === '--data-dir') args.dataDir = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument '${arg}'`);
  }
  return args;
}

const USAGE = `Usage:
  DATA_DIR=./data npx tsx scripts/import-gym-backfill.ts \\
    --dir <notion-export-dir> --user <user id> [--dry-run] [--data-dir <dir>]

The export dir must contain sessions.json, exercise-log.json and checkins.json
(manifest.json is used for count verification when present).
--dry-run prints the full import plan without touching any database.`;

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    process.exit(2);
  }
  if (!args.dir) {
    console.error('Missing required --dir argument.');
    console.error(USAGE);
    process.exit(2);
  }
  if (args.dataDir) process.env.DATA_DIR = args.dataDir;

  let data: ExportData;
  try {
    data = loadExport(args.dir);
  } catch (err) {
    console.error(`Could not read export: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const plan = buildPlan(data);

  if (args.dryRun) {
    console.log('DRY RUN — no database writes.\n');
    console.log(formatPlan(plan, { verbose: true }));
    const bad = plan.report.orphanEntries.length + plan.report.invalidCheckins.length;
    process.exit(bad > 0 ? 1 : 0);
  }

  if (!args.user) {
    console.error('Missing required --user argument for a live import.');
    console.error(USAGE);
    process.exit(2);
  }
  const users = await db.select().from(user).where(eq(user.id, args.user)).limit(1);
  if (!users[0]) {
    console.error(`No user with id '${args.user}' in the target database.`);
    process.exit(2);
  }

  console.log(formatPlan(plan));
  console.log('\nImporting…');
  const result = await executePlan(plan, args.user, (line) => console.log(`  ${line}`));
  console.log(
    `\nDone: ${result.sessionsCreated} sessions created (${result.sessionsDeduped} already present), ` +
      `${result.entriesImported} entries, ${result.checkinsUpserted} check-ins ` +
      `(${result.checkinsSkipped} skeleton weeks skipped), ${result.vitalsWritten} vitals rows, ` +
      `${result.seedsCreated} catalog seeds (${result.seedsSkipped} already present).\n`,
  );
  const verification = await formatVerification(plan, data, args.user);
  console.log(verification.text);
  process.exit(verification.ok ? 0 : 1);
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
