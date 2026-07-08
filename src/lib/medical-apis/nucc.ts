export interface SpecialtyResult {
  display: string;
  code: string;
  classification: string;
}

type ClinicalTablesResponse = [
  number,
  string[],
  Record<string, unknown> | null,
  string[][],
];

export async function searchSpecialties(
  query: string,
  signal?: AbortSignal
): Promise<SpecialtyResult[]> {
  if (!query.trim()) return [];

  try {
    const url = `https://clinicaltables.nlm.nih.gov/api/nucc_providers/v3/search?terms=${encodeURIComponent(query)}&maxList=10&df=Classification,Specialization`;
    const response = await fetch(url, { signal });

    if (!response.ok) return [];

    const data = (await response.json()) as ClinicalTablesResponse;
    const [, codes, , displayFields] = data;

    const results: SpecialtyResult[] = [];
    for (let i = 0; i < codes.length; i++) {
      const classification = displayFields[i]?.[0] ?? "";
      const specialization = displayFields[i]?.[1] ?? "";
      const display = specialization ? `${classification} - ${specialization}` : classification;

      results.push({
        display,
        code: codes[i] ?? "",
        classification,
      });
    }

    return results;
  } catch {
    return [];
  }
}
