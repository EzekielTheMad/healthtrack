import { createHash } from 'node:crypto';
import { z } from 'zod';
import { listMedications } from './repos/medications';
import { getProfile } from './repos/profiles';
import { listDependents } from './repos/dependents';
import { listLabResults } from './repos/labs';
import { listVitals, listVitalSourcePreferences } from './repos/vitals';
import { listConditions } from './repos/conditions';
import { listAllergies } from './repos/allergies';
import { listVaccines } from './repos/vaccines';
import { listProcedures } from './repos/procedures';
import { listNotes } from './repos/notes';
import { listAppointments } from './repos/appointments';
import { listWorkouts } from './repos/workouts';
import { listGoals } from './repos/goals';
import { listNutritionDaily } from './repos/nutrition';
import { NotFoundError } from './authz';
import { selectVitalSources, sourceConflicts } from './metrics/source-selection';
import { aggregateVitals, formatAggregatesForPrompt } from './metrics/aggregate';
import { calendarDayInTimeZone, getHealthTrackTimeZone } from './oura/timezone';
import { shiftDayKey } from './dates';
import { rowsToSnake } from './api/snake';
import { getMetric, METRICS } from './metrics/registry';
import { listIntegrationHealth } from './repos/integration-health';
import type { HealthContext } from './claude/query';
import type { ContextEvidence, QueryContextMetadata } from './health-context-types';

export const CONTEXT_VERSION = 2;
export const contextDaysSchema = z.coerce
  .number()
  .pipe(z.union([z.literal(30), z.literal(90), z.literal(365)]));
const VITAL_LIMIT = 20000;

/** One explicit patient. Each repository retains its own authorization checks. */
export async function buildHealthContext(
  actorId: string,
  dependentId: string | null = null,
  days: number = 90,
  now = new Date()
) {
  contextDaysSchema.parse(days);
  const timezone = getHealthTrackTimeZone();
  const endDate = calendarDayInTimeZone(now, timezone);
  const startDate = shiftDayKey(endDate, 1 - days);
  const scope = { ownerId: actorId, dependentId };
  const dependent = dependentId
    ? (await listDependents(actorId)).find((d) => d.id === dependentId)
    : null;
  if (dependentId && !dependent) throw new NotFoundError();
  const [
    profile,
    medications,
    allLabs,
    rawVitals,
    conditions,
    allergies,
    vaccines,
    procedures,
    notes,
    appointments,
    workouts,
    goals,
    nutrition,
    preferences,
    integrations,
  ] = await Promise.all([
    dependentId ? Promise.resolve(null) : getProfile(actorId, actorId),
    listMedications(actorId, scope, { orderBy: 'name' }),
    listLabResults(actorId, scope),
    listVitals(actorId, scope, {
      startDate: shiftDayKey(startDate, -1),
      endDate: `${shiftDayKey(endDate, 1)}T23:59:59.999Z`,
      limit: VITAL_LIMIT,
    }),
    listConditions(actorId, scope),
    listAllergies(actorId, scope),
    listVaccines(actorId, scope),
    listProcedures(actorId, scope),
    listNotes(actorId, scope),
    listAppointments(actorId, scope),
    dependentId
      ? Promise.resolve([])
      : listWorkouts(actorId, scope, { from: `${shiftDayKey(startDate, -1)}T00:00:00Z` }),
    dependentId ? Promise.resolve([]) : listGoals(actorId, actorId, { active: true }),
    dependentId
      ? Promise.resolve([])
      : listNutritionDaily(actorId, { startDate, endDate, limit: 1000 }),
    dependentId ? Promise.resolve([]) : listVitalSourcePreferences(actorId),
    dependentId ? Promise.resolve([]) : listIntegrationHealth(actorId),
  ]);
  const prefs = Object.fromEntries(preferences.map((p) => [p.metricKey, p.preferredSource]));
  const windowVitals = rawVitals.filter((row) => {
    const day = getMetric(row.metricKey)?.intraday
      ? calendarDayInTimeZone(new Date(row.recordedAt), timezone)
      : row.recordedAt.slice(0, 10);
    return day >= startDate && day <= endDate;
  });
  const selectedVitals = selectVitalSources(windowVitals, prefs);
  const labs = allLabs.filter((r) => r.visitDate >= startDate && r.visitDate <= endDate);
  const recentNotes = notes.filter((n) => {
    const day = calendarDayInTimeZone(new Date(n.recordedAt), timezone);
    return day >= startDate && day <= endDate;
  });
  const training = workouts
    .filter((w) => {
      const day = calendarDayInTimeZone(new Date(w.startedAt), timezone);
      return day >= startDate && day <= endDate;
    })
    .map(({ id, startedAt, type, label, durationMin, entries }) => ({
      id,
      started_at: startedAt,
      type,
      label,
      duration_min: durationMin,
      exercise_count: entries.length,
    }));
  const warnings: string[] = [];
  if (rawVitals.length >= VITAL_LIMIT)
    warnings.push(
      `Vital history reached the ${VITAL_LIMIT}-row limit; coverage may be incomplete.`
    );
  if (nutrition.length >= 1000) warnings.push('Nutrition history reached its 1000-row limit.');
  if (selectedVitals.length > 2000)
    warnings.push(
      'AI answers include at most 2000 detailed vital observations, prioritizing named metrics. Full selected-window facts remain available through the context API.'
    );
  const conflicts = sourceConflicts(windowVitals, prefs).filter((c) => c.needsChoice);
  if (conflicts.length)
    warnings.push(
      `Choose a source before interpreting these metrics: ${conflicts.map((c) => c.metricKey).join(', ')}.`
    );
  const nutritionSources = [...new Set(nutrition.map((r) => r.sourcePackage))];
  if (nutritionSources.length > 1)
    warnings.push(
      'Nutrition sources are separate snapshots; never add competing source totals together.'
    );
  const evidence: ContextEvidence[] = [];
  function cite(
    domain: string,
    id: string,
    date: string | null,
    source: string | null,
    href: string
  ) {
    const anchored = [
      'medications',
      'labs',
      'conditions',
      'allergies',
      'vaccines',
      'procedures',
    ].includes(domain);
    evidence.push({
      key: `${domain}:${id}`,
      domain,
      record_id: id,
      date,
      source,
      href: anchored ? `${href}#record-${id}` : href,
    });
  }
  medications.forEach((m) => cite('medications', m.id, m.startDate, null, '/medications'));
  labs.forEach((r) => cite('labs', r.id, r.visitDate, null, '/labs'));
  selectedVitals.forEach((r) => cite('vitals', r.id, r.recordedAt, r.source, '/vitals'));
  nutrition.forEach((r) => cite('nutrition', r.id, r.date, r.sourcePackage, '/nutrition'));
  training.forEach((r) => cite('fitness', r.id, r.started_at, null, '/fitness'));
  conditions.forEach((r) => cite('conditions', r.id, r.diagnosedDate, null, '/conditions'));
  recentNotes.forEach((r) => cite('notes', r.id, r.recordedAt, null, '/notes'));
  allergies.forEach((r) => cite('allergies', r.id, r.diagnosedDate, null, '/allergies'));
  vaccines.forEach((r) => cite('vaccines', r.id, r.vaccineDate, null, '/vaccines'));
  procedures.forEach((r) => cite('procedures', r.id, r.procedureDate, null, '/procedures'));
  const facts = {
    subject: {
      name: dependent?.name ?? profile?.displayName ?? 'Your record',
      dependent_id: dependentId,
      date_of_birth: dependent?.dateOfBirth ?? profile?.dateOfBirth ?? null,
    },
    medications: rowsToSnake(medications),
    labs: rowsToSnake(labs),
    vitals: selectedVitals.map((r) => ({
      id: r.id,
      metric_key: r.metricKey,
      value: r.value,
      unit: r.unit,
      recorded_at: r.recordedAt,
      source: r.source,
      last_received_at: r.lastReceivedAt,
    })),
    conditions: rowsToSnake(conditions),
    allergies: rowsToSnake(allergies),
    vaccines: rowsToSnake(vaccines),
    procedures: rowsToSnake(procedures),
    notes: rowsToSnake(recentNotes),
    appointments: rowsToSnake(
      appointments.filter((a) => a.appointmentDate.slice(0, 10) >= endDate)
    ),
    fitness: training,
    goals: rowsToSnake(goals),
    nutrition: rowsToSnake(nutrition),
    integrations: rowsToSnake(integrations),
  };
  const coverage = {
    start_date: startDate,
    end_date: endDate,
    timezone,
    counts: {
      medications: medications.length,
      labs: labs.length,
      vitals: selectedVitals.length,
      nutrition_days: new Set(nutrition.map((r) => r.date)).size,
      workouts: training.length,
    },
    unavailable_domains: dependentId ? ['nutrition', 'fitness', 'integrations'] : [],
    warnings,
  };
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ version: CONTEXT_VERSION, facts, coverage }))
    .digest('hex');
  const metadata: QueryContextMetadata = {
    context_version: CONTEXT_VERSION,
    fingerprint,
    subject_name: facts.subject.name,
    dependent_id: dependentId,
    coverage,
    evidence,
  };
  return { generated_at: now.toISOString(), ...metadata, facts };
}

export type HealthContextSnapshot = Awaited<ReturnType<typeof buildHealthContext>>;
export function queryContextMetadata(snapshot: HealthContextSnapshot): QueryContextMetadata {
  return {
    context_version: snapshot.context_version,
    fingerprint: snapshot.fingerprint,
    subject_name: snapshot.subject_name,
    dependent_id: snapshot.dependent_id,
    coverage: snapshot.coverage,
    evidence: snapshot.evidence,
  };
}

/** Deterministic prompt values share exactly the same facts as the PAT endpoint. */
export function contextForPrompt(snapshot: HealthContextSnapshot, question = ''): HealthContext {
  const f = snapshot.facts;
  const json = (data: unknown) => JSON.stringify(data);
  const text = question.toLowerCase();
  const named = new Set(
    METRICS.filter(
      (metric) =>
        text.includes(metric.key.replaceAll('_', ' ')) ||
        text.includes(metric.key) ||
        text.includes(metric.label.toLowerCase())
    ).map((metric) => metric.key)
  );
  const detail = [...f.vitals]
    .sort(
      (a, b) =>
        Number(named.has(b.metric_key)) - Number(named.has(a.metric_key)) ||
        b.recorded_at.localeCompare(a.recorded_at)
    )
    .slice(0, 2000);
  return {
    profile_data: json({ ...f.subject, coverage: snapshot.coverage, integrations: f.integrations }),
    medications_data: json(f.medications),
    lab_results_data: json(f.labs),
    vitals_data:
      formatAggregatesForPrompt(
        aggregateVitals(
          f.vitals.map((v) => ({
            metricKey: v.metric_key,
            value: v.value,
            recordedAt: v.recorded_at,
          })),
          new Date(snapshot.generated_at)
        )
      ) +
      '\nSelected-window statistics: ' +
      json(
        [...Map.groupBy(f.vitals, (row) => row.metric_key)].map(([metric, rows]) => ({
          metric,
          source: rows[0].source,
          samples: rows.length,
          days_observed: new Set(
            rows.map((r) =>
              getMetric(metric)?.intraday
                ? calendarDayInTimeZone(new Date(r.recorded_at), snapshot.coverage.timezone)
                : r.recorded_at.slice(0, 10)
            )
          ).size,
          latest: rows[0],
          mean:
            getMetric(metric)?.valueType === 'ordinal'
              ? undefined
              : rows.reduce((sum, row) => sum + row.value, 0) / rows.length,
          min: Math.min(...rows.map((r) => r.value)),
          max: Math.max(...rows.map((r) => r.value)),
        }))
      ) +
      '\nDetailed dated observations (newest first, named metrics first; ' +
      detail.length +
      ' of ' +
      f.vitals.length +
      ' observations):\n' +
      detail
        .map(
          (v) =>
            `[vitals:${v.id}] ${v.recorded_at} ${v.metric_key}=${v.value} ${v.unit ?? ''} source=${v.source}`
        )
        .join('\n'),
    flagged_data: json(f.labs.filter((r) => r.flag && r.flag !== 'normal')),
    conditions_data: json({
      conditions: f.conditions,
      allergies: f.allergies,
      vaccines: f.vaccines,
      procedures: f.procedures,
    }),
    recent_notes: json(f.notes),
    appointments_data: json(f.appointments),
    fitness_data: json({ workouts: f.fitness, goals: f.goals }),
    nutrition_data: json(f.nutrition),
  };
}

/** Model-written references only become links after membership validation. */
export function validateAnswerReferences(
  answer: string,
  evidence: readonly ContextEvidence[]
): string {
  const allowed = new Map(evidence.map((item) => [item.key, item.href]));
  return answer.replace(
    /\[((?:medications|labs|vitals|nutrition|fitness|conditions|notes|allergies|vaccines|procedures):[a-zA-Z0-9_-]+)\]/g,
    (_match, key: string) =>
      allowed.has(key) ? `[${key}](${allowed.get(key)})` : '[reference unavailable]'
  );
}
