'use client';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { HealthSummaryPdfProps } from '@/components/export/HealthSummaryPdf';
export function usePdfExport() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();
  async function generatePdf(sections: string[]) {
    setGenerating(true);
    setError(null);
    try {
      if (delegateOwnerId)
        throw new Error('Switch to your own record or a dependent to generate a summary.');
      const qs = dependentId ? `?dependent_id=${encodeURIComponent(dependentId)}` : '';
      const summary = await apiFetch<HealthSummaryPdfProps>(`/api/doctor-summary${qs}`);
      const [{ pdf }, { default: HealthSummaryPdf }, { createElement }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/export/HealthSummaryPdf'),
        import('react'),
      ]);
      const doc = createElement(HealthSummaryPdf, { ...summary, sections });
      const blob = await pdf(doc as unknown as ReactElement<DocumentProps>).toBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `healthtrack-summary-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF generation failed');
    } finally {
      setGenerating(false);
    }
  }
  return { generating, error, generatePdf };
}
