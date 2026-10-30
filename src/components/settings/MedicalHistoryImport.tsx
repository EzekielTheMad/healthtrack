'use client';

import { useEffect, useRef, useState } from 'react';
import { useDependents } from '@/hooks/useDependents';
import { apiFetch } from '@/lib/api/client';
import ImportBatchReview from './ImportBatchReview';

interface SavedBatch {
  id: string;
  file_name: string;
  status: string;
  created_at: string;
}
export default function MedicalHistoryImport({
  extractionEnabled = true,
}: {
  extractionEnabled?: boolean;
}) {
  const { dependents } = useDependents();
  const [profileId, setProfileId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [savedReviews, setSavedReviews] = useState<{ profileId: string; rows: SavedBatch[] }>({
    profileId: '',
    rows: [],
  });
  const recent = savedReviews.profileId === profileId ? savedReviews.rows : [];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryExtraction, setRetryExtraction] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    const query = profileId ? `?dependent_id=${encodeURIComponent(profileId)}` : '';
    apiFetch<SavedBatch[]>(`/api/import-batches${query}`)
      .then((rows) => {
        if (active) setSavedReviews({ profileId, rows });
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load saved reviews.');
      });
    return () => {
      active = false;
    };
  }, [profileId, refresh]);
  async function extract() {
    if (!file) return;
    if (
      !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) &&
      !/\.(pdf|png|jpe?g)$/i.test(file.name)
    ) {
      setError('Choose a PDF, PNG or JPG.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('PDFs must be under 50MB; images under 10MB.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (profileId) form.append('dependent_id', profileId);
      if (retryExtraction) form.append('retry_extraction', 'true');
      const response = await fetch('/api/parse-medical-history', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok || !body.batch_id)
        throw new Error(
          body.message ?? 'Could not extract this document. Your saved reviews are unchanged.'
        );
      setBatchId(body.batch_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not extract document.');
    } finally {
      setBusy(false);
    }
  }
  function close() {
    setBatchId(null);
    setRefresh((value) => value + 1);
  }
  if (batchId) return <ImportBatchReview batchId={batchId} onComplete={close} onCancel={close} />;
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Upload a medical history to review medications, conditions, allergies, procedures, vaccines
        and labs. Extracted claims stay separate until you approve them. Reuploading the same
        document resumes its review for this patient.
      </p>
      <label className="block text-sm">
        Import into profile
        <select
          className="block rounded-lg border p-2 mt-1 w-full"
          style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-card)' }}
          value={profileId}
          disabled={busy}
          onChange={(event) => {
            setProfileId(event.target.value);
            setError(null);
          }}
        >
          <option value="">Myself</option>
          {dependents.map((dependent) => (
            <option key={dependent.id} value={dependent.id}>
              {dependent.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        PDF (up to 50MB), PNG or JPG (up to 10MB)
        <input
          ref={input}
          className="block mt-2 w-full"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          disabled={busy}
          checked={retryExtraction}
          onChange={(event) => setRetryExtraction(event.target.checked)}
        />
        Retry an incomplete extraction of this file. This uses AI again; already applied records
        remain saved.
      </label>
      {error && (
        <p role="alert" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}
      {!extractionEnabled && (
        <p className="text-sm">
          AI extraction is not configured. Saved document reviews remain available below.
        </p>
      )}
      <button
        className="rounded-lg px-4 py-2 border"
        style={{ borderColor: 'var(--border-card)' }}
        disabled={!extractionEnabled || busy || !file}
        onClick={extract}
      >
        {busy ? 'Extracting document; large PDFs may take several minutes…' : 'Extract and review'}
      </button>
      {recent.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-medium">Saved document reviews</h3>
          {recent.map((batch) => (
            <button
              className="block text-left w-full rounded-lg border p-3 text-sm"
              style={{ borderColor: 'var(--border-card)' }}
              key={batch.id}
              onClick={() => setBatchId(batch.id)}
            >
              {batch.file_name} ·{' '}
              {batch.status === 'complete'
                ? 'Completed'
                : batch.status === 'incomplete'
                  ? 'Incomplete extraction'
                  : 'Review pending'}{' '}
              · {batch.created_at.slice(0, 10)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
