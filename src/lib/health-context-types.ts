/** Public, client-safe provenance contract. No provider credentials or raw uploads. */
export interface ContextEvidence {
  key: string;
  domain: string;
  record_id: string;
  date: string | null;
  source: string | null;
  href: string;
}

export interface ContextCoverage {
  start_date: string;
  end_date: string;
  timezone: string;
  counts: Record<string, number>;
  unavailable_domains: string[];
  warnings: string[];
}

export interface QueryContextMetadata {
  context_version: number;
  fingerprint: string;
  subject_name: string;
  dependent_id: string | null;
  coverage: ContextCoverage;
  evidence: ContextEvidence[];
}
