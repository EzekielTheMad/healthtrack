export interface ConditionResult {
  display: string;
  code: string;
}

export interface LoincResult {
  display: string;
  code: string;
}

export interface CptResult {
  display: string;
  code: string;
}

type ClinicalTablesResponse = [
  number,
  string[],
  Record<string, unknown> | null,
  string[][],
];

// Conditions API response with extra fields
type ConditionsApiResponse = [
  number,
  string[],
  { icd10cm_codes?: (string | null)[], primary_name?: string[] } | null,
  string[][],
];

export async function searchConditions(
  query: string,
  signal?: AbortSignal
): Promise<ConditionResult[]> {
  if (!query.trim()) return [];

  try {
    // Use the consumer-friendly "conditions" table which maps common names
    // (e.g. "cancer", "diabetes") to ICD-10 codes, instead of searching
    // raw ICD-10 codes which use clinical terminology like "malignant neoplasm"
    const url = `https://clinicaltables.nlm.nih.gov/api/conditions/v3/search?terms=${encodeURIComponent(query)}&ef=icd10cm_codes,primary_name&maxList=15`;
    const response = await fetch(url, { signal });

    if (!response.ok) return [];

    const data = (await response.json()) as ConditionsApiResponse;
    const [, , extraFields, displayFields] = data;
    const icd10Codes = extraFields?.icd10cm_codes ?? [];
    const primaryNames = extraFields?.primary_name ?? [];

    const results: ConditionResult[] = [];
    for (let i = 0; i < displayFields.length; i++) {
      const name = primaryNames[i] ?? displayFields[i]?.[0] ?? "";
      const code = icd10Codes[i] ?? "";
      results.push({
        display: name,
        code: code ?? "",
      });
    }

    return results;
  } catch {
    return [];
  }
}

export async function searchLoincTests(
  query: string,
  signal?: AbortSignal
): Promise<LoincResult[]> {
  if (!query.trim()) return [];

  try {
    const url = `https://clinicaltables.nlm.nih.gov/api/loinc_items/v3/search?terms=${encodeURIComponent(query)}&maxList=10&df=LONG_COMMON_NAME,LOINC_NUM`;
    const response = await fetch(url, { signal });

    if (!response.ok) return [];

    const data = (await response.json()) as ClinicalTablesResponse;
    const [, codes, , displayFields] = data;

    const results: LoincResult[] = [];
    for (let i = 0; i < codes.length; i++) {
      const name = displayFields[i]?.[0] ?? "";
      const loincNum = displayFields[i]?.[1] ?? codes[i] ?? "";
      results.push({
        display: name,
        code: loincNum,
      });
    }

    return results;
  } catch {
    return [];
  }
}

export async function searchProcedures(
  query: string,
  signal?: AbortSignal
): Promise<CptResult[]> {
  if (!query.trim()) return [];

  try {
    const url = `https://clinicaltables.nlm.nih.gov/api/procedures/v3/search?terms=${encodeURIComponent(query)}&maxList=10`;
    const response = await fetch(url, { signal });

    if (!response.ok) return [];

    const data = (await response.json()) as ClinicalTablesResponse;
    const [, codes, , displayFields] = data;

    const results: CptResult[] = [];
    for (let i = 0; i < codes.length; i++) {
      const name = displayFields[i]?.[0] ?? codes[i] ?? "";
      results.push({
        display: name,
        code: codes[i] ?? "",
      });
    }

    return results;
  } catch {
    return [];
  }
}
