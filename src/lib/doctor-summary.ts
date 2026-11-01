import { getProfile } from './repos/profiles';
import { listDependents } from './repos/dependents';
import { listMedications } from './repos/medications';
import { listConditions } from './repos/conditions';
import { listAllergies } from './repos/allergies';
import { listVaccines } from './repos/vaccines';
import { listProviders } from './repos/providers';
import { listVitals, listVitalSourcePreferences } from './repos/vitals';
import { listLabResults } from './repos/labs';
import { NotFoundError } from './authz';
import { selectVitalSources, sourceConflicts } from './metrics/source-selection';
import type { HealthSummaryPdfProps } from '@/components/export/HealthSummaryPdf';
import { getHealthTrackTimeZone } from './oura/timezone';
import { vitalSourceLabel } from './metrics/source-label';
import { listBodyScans, selectCoherentScan } from './fidelity/scans';
import { listClinicalFacts } from './fidelity/clinical';
import { clinicalDoctorRecords, doctorLabIdentity } from './fidelity/presentation';

export async function buildDoctorSummary(
  actorId: string,
  dependentId: string | null = null
): Promise<HealthSummaryPdfProps & { warnings: string[] }> {
  const scope = { ownerId: actorId, dependentId };
  const dependent = dependentId
    ? (await listDependents(actorId)).find((d) => d.id === dependentId)
    : null;
  if (dependentId && !dependent) throw new NotFoundError();
  const [
    profile,
    medications,
    conditions,
    allergies,
    vaccines,
    providers,
    rawVitals,
    rawLabs,
    preferences,
    bodyScanHistory,
    clinicalHistory,
  ] = await Promise.all([
    dependentId ? Promise.resolve(null) : getProfile(actorId, actorId),
    listMedications(actorId, scope, { orderBy: 'name' }),
    listConditions(actorId, scope),
    listAllergies(actorId, scope),
    listVaccines(actorId, scope),
    listProviders(actorId, scope),
    listVitals(actorId, scope, { limit: 20000 }),
    listLabResults(actorId, scope),
    dependentId ? Promise.resolve([]) : listVitalSourcePreferences(actorId),
    listBodyScans(actorId, scope, { limit: 100 }),
    listClinicalFacts(actorId, scope, { limit: 1000 }),
  ]);
  const prefs = Object.fromEntries(preferences.map((p) => [p.metricKey, p.preferredSource]));
  const scanSelection = selectCoherentScan(bodyScanHistory, prefs);
  const bodyScans = scanSelection.scan ? [scanSelection.scan] : bodyScanHistory.slice(0, 5);
  const typedSelection = clinicalDoctorRecords(clinicalHistory, getHealthTrackTimeZone(), rawLabs);
  const typedClinical = typedSelection.records;
  const selected = selectVitalSources(rawVitals, prefs);
  const latestVitals = selected.filter(
    (v, i) => selected.findIndex((r) => r.metricKey === v.metricKey) === i
  );
  const orderedLabs = [...rawLabs].sort(
    (a, b) => b.visitDate.localeCompare(a.visitDate) || b.createdAt.localeCompare(a.createdAt)
  );
  const latestLabs = orderedLabs.filter((r) => {
    const key = doctorLabIdentity(r.testName, r.loincCode, r.unit);
    return typedSelection.latestLabDates.get(key) === r.visitDate;
  });
  return {
    timezone: getHealthTrackTimeZone(),
    bodyScans,
    typedClinical,
    sections: ['medications', 'conditions', 'allergies', 'vitals', 'labs', 'providers', 'vaccines'],
    profile: {
      display_name: dependent?.name ?? profile?.displayName ?? 'Your record',
      date_of_birth: dependent?.dateOfBirth ?? profile?.dateOfBirth ?? undefined,
      biological_sex: dependent?.biologicalSex ?? profile?.biologicalSex ?? undefined,
      height_inches: profile?.heightInches ?? undefined,
      weight_lbs: profile?.weightLbs ?? undefined,
    },
    medications: medications.map((m) => ({
      name: m.name,
      dosage: m.dosage ?? undefined,
      frequency: m.frequency ?? '',
      active: m.active,
      start_date: m.startDate ?? undefined,
      end_date: m.endDate ?? undefined,
    })),
    conditions: conditions.map((c) => ({
      name: c.name,
      status: c.status,
      diagnosed_date: c.diagnosedDate ?? undefined,
    })),
    allergies: allergies.map((a) => ({
      name: a.name,
      severity: a.severity,
      reaction: a.reaction ?? undefined,
    })),
    vaccines: vaccines.map((v) => ({
      name: v.name,
      vaccine_date: v.vaccineDate,
      dose_number: v.doseNumber ?? undefined,
      series_doses: v.seriesDoses ?? undefined,
    })),
    providers: providers.map((p) => ({
      name: p.name,
      provider_type: p.providerType ?? 'unknown',
      specialty: p.specialty ?? undefined,
      phone: p.phone ?? undefined,
    })),
    vitals: latestVitals.map((v) => ({
      metric_key: v.metricKey,
      value: v.value,
      unit: v.unit ?? undefined,
      recorded_at: v.recordedAt,
      source: v.source,
      source_label: vitalSourceLabel(v.source, v.metadata),
    })),
    labResults: latestLabs.map((r) => ({
      test_name: r.testName,
      value: r.value,
      unit: r.unit ?? undefined,
      flag: r.flag ?? 'unknown',
      reference_range_low: r.referenceRangeLow ?? undefined,
      reference_range_high: r.referenceRangeHigh ?? undefined,
      reference_range_text: r.referenceRangeText ?? undefined,
      visit_date: r.visitDate,
    })),
    warnings: [
      ...typedSelection.warnings,
      ...(clinicalHistory.length >= 1000
        ? [
            'Typed clinical summary is bounded to 1000 records; full export retains complete source history.',
          ]
        : []),
      ...(typedClinical.some((record) => record.legacy_conflict)
        ? [
            'Some corrected clinical records conflict with changed legacy source values. The typed history shows both for review; no current exact result is implied.',
          ]
        : []),
      ...scanSelection.warnings,
      ...(bodyScanHistory.length >= 100
        ? [
            'Body scan selection considers at most 100 sessions; use the full data export for complete history.',
          ]
        : []),
      ...(!scanSelection.scan && bodyScans.length
        ? [
            'No unambiguous latest scan is available; the displayed scans are separate history, not a combined current assessment.',
          ]
        : []),
      ...sourceConflicts(rawVitals, prefs)
        .filter((c) => c.needsChoice)
        .map(
          (c) => `Choose a source for ${c.metricKey} in Vitals; it is omitted from this summary.`
        ),
    ],
  };
}
