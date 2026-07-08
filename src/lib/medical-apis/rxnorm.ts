export interface RxNormResult {
  display: string;
  code: string;
  brandName?: string;
  genericName?: string;
  strengths?: string[];
}

// RxTerms Clinical Tables response: [count, codes[], extraFields, displayFields[][]]
type RxTermsResponse = [
  number,
  string[],
  { RXCUIS?: string[][]; STRENGTHS_AND_FORMS?: string[][] } | null,
  string[][],
];

export async function searchRxNorm(
  query: string,
  signal?: AbortSignal
): Promise<RxNormResult[]> {
  if (!query.trim()) return [];

  try {
    // Use RxTerms Clinical Tables API — returns consumer-friendly drug names
    // (e.g. "Vyvanse (Oral Pill)") instead of raw RxNorm concepts
    const url = `https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms=${encodeURIComponent(query)}&ef=RXCUIS,STRENGTHS_AND_FORMS&maxList=15`;
    const response = await fetch(url, { signal });

    if (!response.ok) return [];

    const data = (await response.json()) as RxTermsResponse;
    const [, names, extraFields] = data;
    const rxcuisGroups = extraFields?.RXCUIS ?? [];
    const strengthsGroups = extraFields?.STRENGTHS_AND_FORMS ?? [];

    const results: RxNormResult[] = [];

    for (let i = 0; i < names.length; i++) {
      // Use the first RXCUI from each group (most common strength)
      const rxcui = rxcuisGroups[i]?.[0] ?? '';
      results.push({
        display: names[i] ?? '',
        code: rxcui,
        strengths: strengthsGroups[i] ?? [],
      });
    }

    return results;
  } catch {
    return [];
  }
}

