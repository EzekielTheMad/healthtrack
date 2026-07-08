'use client';

import { useState } from 'react';
import type { ReactElement } from 'react';
// Type-only import: erased at compile time, so it does not defeat the
// dynamic import() below that keeps @react-pdf/renderer out of SSR.
import type { DocumentProps } from '@react-pdf/renderer';
import { apiFetch } from '@/lib/api/client';
import type {
  Allergy,
  Condition,
  LabResult,
  Medication,
  Profile,
  Provider,
  Vaccine,
  Vital,
} from '@/lib/types';

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

export function usePdfExport() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generatePdf(sections: string[]) {
    setGenerating(true);
    setError(null);

    try {
      // Fetch all data in parallel. Vitals + lab results historically read the
      // user's own rows without a dependent filter → ?dependent_id=all.
      const [
        profile,
        medications,
        conditions,
        allergies,
        rawVitals,
        rawLabs,
        providers,
        vaccines,
      ] = await Promise.all([
        apiFetch<Profile>('/api/profile'),
        sections.includes('medications')
          ? apiFetch<Medication[]>('/api/medications?active=true')
          : Promise.resolve([]),
        sections.includes('conditions')
          ? apiFetch<Condition[]>('/api/conditions')
          : Promise.resolve([]),
        sections.includes('allergies')
          ? apiFetch<Allergy[]>('/api/allergies')
          : Promise.resolve([]),
        sections.includes('vitals')
          ? apiFetch<Vital[]>('/api/vitals?dependent_id=all')
          : Promise.resolve([]),
        sections.includes('labs')
          ? apiFetch<LabResult[]>('/api/labs/results?dependent_id=all')
          : Promise.resolve([]),
        sections.includes('providers')
          ? apiFetch<Provider[]>('/api/providers')
          : Promise.resolve([]),
        sections.includes('vaccines')
          ? apiFetch<Vaccine[]>('/api/vaccines')
          : Promise.resolve([]),
      ]);

      // Deduplicate vitals: keep latest per metric_key (rows arrive
      // recorded_at desc)
      const latestVitalsMap = new Map<string, (typeof rawVitals)[0]>();
      for (const v of rawVitals) {
        if (!latestVitalsMap.has(v.metric_key)) {
          latestVitalsMap.set(v.metric_key, v);
        }
      }
      const vitals = Array.from(latestVitalsMap.values()).map((v) => ({
        metric_key: v.metric_key,
        value: v.value,
        unit: v.unit ?? undefined,
        recorded_at: v.recorded_at,
      }));

      // Deduplicate lab results: keep latest per test_name (rows arrive
      // created_at desc)
      const latestLabsMap = new Map<string, (typeof rawLabs)[0]>();
      for (const lab of rawLabs) {
        if (!latestLabsMap.has(lab.test_name)) {
          latestLabsMap.set(lab.test_name, lab);
        }
      }
      const labResults = Array.from(latestLabsMap.values()).map((lab) => ({
        test_name: lab.test_name,
        value: lab.value,
        flag: lab.flag ?? 'normal',
        unit: lab.unit ?? undefined,
        reference_range_low: lab.reference_range_low ?? undefined,
        reference_range_high: lab.reference_range_high ?? undefined,
      }));

      // Dynamic import to avoid SSR issues
      const [{ pdf }, { default: HealthSummaryPdf }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/export/HealthSummaryPdf'),
      ]);

      const { createElement } = await import('react');

      const summaryDocument = createElement(HealthSummaryPdf, {
          profile: {
            display_name: profile.display_name ?? 'Unknown',
            date_of_birth: profile.date_of_birth ?? undefined,
            biological_sex: profile.biological_sex ?? undefined,
            height_inches: profile.height_inches ?? undefined,
            weight_lbs: profile.weight_lbs ?? undefined,
          },
          sections,
          medications: [...medications].sort(byName) as Array<{
            name: string;
            dosage?: string;
            frequency: string;
            active: boolean;
          }>,
          conditions: [...conditions].sort(byName) as Array<{
            name: string;
            status: string;
            diagnosed_date?: string;
          }>,
          allergies: [...allergies].sort(byName) as Array<{
            name: string;
            severity: string;
            reaction?: string;
          }>,
          vitals,
          labResults,
          providers: [...providers].sort(byName) as Array<{
            name: string;
            provider_type: string;
            specialty?: string;
            phone?: string;
          }>,
          vaccines: vaccines as Array<{
            name: string;
            vaccine_date: string;
            dose_number?: number;
            series_doses?: number;
          }>,
      });

      // HealthSummaryPdf renders a <Document>, but its element type carries
      // its own props, while pdf() is typed as ReactElement<DocumentProps>.
      const blob = await pdf(
        summaryDocument as unknown as ReactElement<DocumentProps>,
      ).toBlob();

      const date = new Date().toISOString().split('T')[0];
      const filename = `healthtrack-summary-${date}.pdf`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF generation failed');
    } finally {
      setGenerating(false);
    }
  }

  return { generating, error, generatePdf };
}
