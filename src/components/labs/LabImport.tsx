'use client';

import React, { useCallback, useRef, useState } from 'react';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import type { ParsedLabResult } from '@/lib/claude/parse-lab';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { useRouter } from 'next/navigation';

interface LabImportProps {
  onParsed: (results: ParsedLabResult, storagePath: string) => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export default function LabImport({ onParsed }: LabImportProps) {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const router = useRouter();
  const [typed, setTyped] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retainedDocument, setRetainedDocument] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      setRetainedDocument(null);
      if (delegateOwnerId) {
        setError('Only the patient profile owner can import lab documents.');
        return;
      }

      if (!ACCEPTED_TYPES.includes(file.type) && !/\.(pdf|png|jpe?g)$/i.test(file.name)) {
        setError('Only PDF, PNG, and JPG files are accepted.');
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setError('File size must be under 10MB.');
        return;
      }

      setFileName(file.name);
      setUploading(true);

      try {
        const formData = new FormData();
        formData.append('file', file);
        if (dependentId) formData.append('dependent_id', dependentId);

        setUploading(false);
        setParsing(true);

        const res = await fetch('/api/parse-lab-pdf' + (typed ? '?format=typed' : ''), {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (typed && typeof body?.document_id === 'string') setRetainedDocument(body.document_id);
          const msg = body?.message ?? `Upload failed (${res.status})`;
          throw new Error(msg);
        }

        const response = await res.json();
        if (response.typed) {
          const query = new URLSearchParams({ document_id: response.document_id });
          if (response.clinical_batch_id) query.set('batch_id', response.clinical_batch_id);
          router.push('/clinical-intake?' + query);
          return;
        }
        const { parsed, storagePath } = response as {
          parsed: ParsedLabResult;
          storagePath: string;
        };

        onParsed(parsed, storagePath);
      } catch (err) {
        // Parsing runs through the AI extractor; if it fails, keep it friendly
        // and point the user at manual entry rather than surfacing a raw error.
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't read this document. Try again; saved reviews remain available in Settings."
        );
      } finally {
        setUploading(false);
        setParsing(false);
      }
    },
    [onParsed, dependentId, delegateOwnerId, typed, router]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const isProcessing = uploading || parsing;

  return (
    <div className="space-y-4">
      {retainedDocument && (
        <a
          className="underline text-sm"
          href={'/clinical-intake?document_id=' + encodeURIComponent(retainedDocument)}
        >
          Open retained source and extraction status
        </a>
      )}
      <label
        className="flex items-start gap-2 rounded-lg border p-3 text-sm"
        style={{ borderColor: 'var(--border-card)' }}
      >
        <input
          type="checkbox"
          checked={typed}
          disabled={isProcessing}
          onChange={(event) => setTyped(event.target.checked)}
        />
        <span>
          <strong>Typed clinical document review</strong> — preserve qualitative, censored and
          canceled results, partial dates and printed evidence. An owner approves the exact preview
          before accepted records change.
        </span>
      </label>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {typed
          ? 'AI extraction may incur provider charges. Limits: 10 MB per PDF/image, 100 staged results and 2,000 retained extracted rows (512 KiB) per review. This single-pass lab extractor does not certify complete page coverage; split large histories. Unsupported rows remain held; the original is retained.'
          : 'Legacy numeric-only review omits qualitative/canceled results and holds thresholds for correction. Enable typed review for full supported outcome types.'}
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !isProcessing && inputRef.current?.click()}
        className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors cursor-pointer"
        style={{
          borderColor: dragOver ? 'var(--color-sage)' : 'var(--border-card)',
          backgroundColor: dragOver ? 'rgba(129, 178, 154, 0.05)' : 'var(--bg-card)',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={handleFileChange}
          className="hidden"
          disabled={isProcessing}
        />

        {isProcessing ? (
          <>
            <LoadingSpinner size="lg" />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {uploading ? 'Uploading...' : 'Parsing lab results with AI...'}
            </p>
            {fileName && (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {fileName}
              </p>
            )}
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ color: 'var(--color-text-muted)' }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Drop a lab PDF or image here, or click to browse
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              PDF, PNG, JPG up to 10MB
            </p>
          </>
        )}
      </div>

      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{
            backgroundColor: 'var(--bg-card)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--border-card)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
