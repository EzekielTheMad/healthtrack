import type { ParsedMedicalHistory } from '@/lib/claude/parse-medical-history';
import type { ParsedLabResult } from '@/lib/claude/parse-lab';
import type { StagedClaim } from './batches';

export function historyClaims(parsed: ParsedMedicalHistory): StagedClaim[] {
  const rows: StagedClaim[] = [];
  for (const domain of [
    'medications',
    'conditions',
    'allergies',
    'procedures',
    'vaccines',
  ] as const) {
    for (const payload of parsed[domain]) rows.push({ domain, payload: { ...payload } });
  }
  parsed.lab_visits.forEach((visit, index) => {
    for (const result of visit.results)
      rows.push({
        domain: 'lab_results',
        payload: { ...result, visit_date: visit.visit_date, _visit_key: String(index) },
      });
  });
  return rows;
}
export function labClaims(parsed: ParsedLabResult): StagedClaim[] {
  return parsed.results.map((result, index) => {
    const date = Object.hasOwn(result, 'visit_date')
      ? result.visit_date
      : parsed.multiple_collection_dates
        ? null
        : parsed.visit_date;
    const context = [date, result.accession_id, result.specimen_id, result.collected_at]
      .map((value) => value ?? '')
      .join('|');
    return {
      domain: 'lab_results',
      payload: {
        ...result,
        visit_date: date ?? null,
        provider_name: parsed.provider_name,
        _visit_key: parsed.multiple_collection_dates && !date ? `unknown:${index}` : context,
      },
    };
  });
}
