'use client';

import React, { useCallback, useRef, useState } from 'react';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import type { ParsedVaccinePdfResult } from '@/lib/claude/parse-vaccine-pdf';

interface VaccineImportProps {
  onParsed: (results: ParsedVaccinePdfResult) => void;
  onCancel: () => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export default function VaccineImport({ onParsed, onCancel }: VaccineImportProps) {
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);

      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError('Only PDF, PNG, and JPG files are accepted.');
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setError('File size must be under 10MB.');
        return;
      }

      setFileName(file.name);
      setProcessing(true);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/parse-vaccine-pdf', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const msg = body?.message ?? `Upload failed (${res.status})`;
          throw new Error(msg);
        }

        const { parsed } = (await res.json()) as { parsed: ParsedVaccinePdfResult };
        onParsed(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      } finally {
        setProcessing(false);
      }
    },
    [onParsed],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Import Vaccine Record
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium cursor-pointer"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Cancel
        </button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !processing && inputRef.current?.click()}
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
          disabled={processing}
        />

        {processing ? (
          <>
            <LoadingSpinner size="lg" />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              Parsing vaccine record with AI...
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
              Drop a vaccine record PDF or image, or click to browse
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
            backgroundColor: 'rgba(224, 122, 95, 0.1)',
            color: 'var(--color-terracotta)',
            border: '1px solid rgba(248,113,113,0.2)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
