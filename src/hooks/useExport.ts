'use client';

import { useState } from 'react';

export function useExport() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresReauth, setRequiresReauth] = useState(false);

  async function exportData(format: 'json') {
    setExporting(true);
    setError(null);
    setRequiresReauth(false);

    try {
      const response = await fetch(`/api/export-data?format=${format}`);

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 403 && body?.error === 'reauth_required') {
          setRequiresReauth(true);
          return;
        }
        throw new Error(body?.message ?? `Export failed (${response.status})`);
      }

      const blob = await response.blob();
      const date = new Date().toISOString().split('T')[0];
      const filename = `healthtrack-export-${date}.json`;

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      // Persist last export date
      localStorage.setItem('healthtrack_last_export', new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  function confirmedAuthentication() {
    setRequiresReauth(false);
    setError(null);
  }

  return { exporting, error, requiresReauth, exportData, confirmedAuthentication };
}
