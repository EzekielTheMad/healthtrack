import { NextRequest } from 'next/server';
import { validateApiKey, unauthorized, forbidden } from '@/lib/api-auth';
import { getProfile } from '@/lib/repos/profiles';
import { listMedications } from '@/lib/repos/medications';
import { listConditions } from '@/lib/repos/conditions';
import { listAllergies } from '@/lib/repos/allergies';
import { listVitals } from '@/lib/repos/vitals';
import { listLabResultsV1 } from '@/lib/repos/labs';
import { listProviders } from '@/lib/repos/providers';
import { listVaccines } from '@/lib/repos/vaccines';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  const ctx = await validateApiKey(authHeader);
  if (!ctx) return unauthorized();
  // Summary requires read:all — not satisfied by individual read:* scopes
  if (!ctx.scopes.includes('read:all')) return forbidden('read:all');

  const userId = ctx.userId;
  const now = new Date();

  const since30 = new Date(now);
  since30.setDate(since30.getDate() - 30);

  // PAT scope: the key owner's own data only (dependent_id NULL), the key
  // owner as both actor and owner. Field lists, orderings and limits are
  // byte-identical to the legacy service-role implementation.
  const scope = { ownerId: userId, dependentId: null };

  const [
    profile,
    medications,
    conditions,
    allergies,
    vitals,
    labs,
    providers,
    vaccines,
  ] = await Promise.all([
    getProfile(userId, userId),
    listMedications(userId, scope, { active: true, orderBy: 'name' }),
    listConditions(userId, scope, { orderBy: 'diagnosed_date' }),
    listAllergies(userId, scope, { orderBy: 'name' }),
    listVitals(userId, scope, { startDate: since30.toISOString(), limit: 200 }),
    listLabResultsV1(userId, { days: 90 }),
    listProviders(userId, scope),
    listVaccines(userId, scope),
  ]);

  const summary = {
    generated_at: now.toISOString(),
    profile: profile
      ? {
          id: profile.id,
          display_name: profile.displayName,
          date_of_birth: profile.dateOfBirth,
          biological_sex: profile.biologicalSex,
          height_inches: profile.heightInches,
          weight_lbs: profile.weightLbs,
          unit_system: profile.unitSystem,
        }
      : null,
    active_medications: medications.map((m) => ({
      id: m.id,
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
      category: m.category,
      start_date: m.startDate,
      end_date: m.endDate,
      active: m.active,
      rxcui: m.rxcui,
    })),
    conditions: conditions.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      diagnosed_date: c.diagnosedDate,
      icd10_code: c.icd10Code,
      notes: c.notes,
    })),
    allergies: allergies.map((a) => ({
      id: a.id,
      name: a.name,
      severity: a.severity,
      reaction: a.reaction,
      diagnosed_date: a.diagnosedDate,
      rxcui: a.rxcui,
    })),
    vitals_last_30_days: vitals.map((v) => ({
      id: v.id,
      metric_key: v.metricKey,
      value: v.value,
      unit: v.unit,
      source: v.source,
      recorded_at: v.recordedAt,
    })),
    labs_last_90_days: labs.map((r) => ({
      id: r.id,
      test_name: r.testName,
      panel_name: r.panelName,
      value: r.value,
      unit: r.unit,
      reference_range_low: r.referenceRangeLow,
      reference_range_high: r.referenceRangeHigh,
      flag: r.flag,
      loinc_code: r.loincCode,
      visit_date: r.visitDate,
    })),
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      provider_type: p.providerType,
      specialty: p.specialty,
      organization: p.organization,
      phone: p.phone,
      address: p.address,
      portal_url: p.portalUrl,
      is_favorite: p.isFavorite,
    })),
    // vaccine_date desc, limit 20 (repo already orders by vaccine_date desc)
    recent_vaccines: vaccines.slice(0, 20).map((v) => ({
      id: v.id,
      name: v.name,
      cvx_code: v.cvxCode,
      vaccine_date: v.vaccineDate,
      dose_number: v.doseNumber,
      series_doses: v.seriesDoses,
      manufacturer: v.manufacturer,
      next_dose_date: v.nextDoseDate,
    })),
  };

  return Response.json(summary, { headers: corsHeaders });
}
