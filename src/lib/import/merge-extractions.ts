/** Preserve every claim; names, richer fields and dates alone do not establish identity. */
import type { ParsedMedicalHistory } from '@/lib/claude/parse-medical-history';
export type MedicalHistoryExtraction = ParsedMedicalHistory;
export function mergeExtractions(parts: MedicalHistoryExtraction[]): MedicalHistoryExtraction {
  return {
    medications: parts.flatMap((part) => part.medications),
    conditions: parts.flatMap((part) => part.conditions),
    allergies: parts.flatMap((part) => part.allergies),
    procedures: parts.flatMap((part) => part.procedures),
    vaccines: parts.flatMap((part) => part.vaccines),
    lab_visits: parts.flatMap((part) => part.lab_visits),
  };
}
