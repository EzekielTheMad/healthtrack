export interface VaccineSearchResult {
  display: string;
  code: string;
}

interface ApproximateCandidate {
  rxcui: string;
  name: string;
  score: string;
  rank: string;
  source?: string;
}

interface ApproximateResponse {
  approximateGroup?: {
    inputTerm: string;
    candidate?: ApproximateCandidate[];
  };
}

/**
 * Search for vaccine names via RxNorm approximate match API,
 * filtered to CVX (Vaccines Administered) source entries.
 */
export async function searchVaccines(
  query: string,
  signal?: AbortSignal,
): Promise<VaccineSearchResult[]> {
  if (!query.trim()) return [];

  try {
    const url = `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(query)}&maxEntries=20`;
    const response = await fetch(url, { signal });

    if (!response.ok) return [];

    const data = (await response.json()) as ApproximateResponse;
    const candidates = data.approximateGroup?.candidate ?? [];

    // Filter to CVX source entries for clean vaccine group names
    const cvxResults = candidates.filter((c) => c.source === 'CVX');

    // Deduplicate by name (CVX can return variants)
    const seen = new Set<string>();
    const results: VaccineSearchResult[] = [];

    for (const c of cvxResults) {
      const normalized = c.name.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      results.push({
        display: c.name,
        code: c.rxcui,
      });
    }

    return results.slice(0, 15);
  } catch {
    return [];
  }
}
