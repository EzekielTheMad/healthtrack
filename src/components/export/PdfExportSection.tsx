'use client';

import { useState } from 'react';
import { usePdfExport } from '@/hooks/usePdfExport';

const SECTIONS = [
  { key: 'medications', label: 'Medications' },
  { key: 'conditions', label: 'Conditions' },
  { key: 'allergies', label: 'Allergies' },
  { key: 'vitals', label: 'Vitals' },
  { key: 'labs', label: 'Lab Results' },
  { key: 'providers', label: 'Providers' },
  { key: 'vaccines', label: 'Vaccines' },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

export default function PdfExportSection() {
  const { generating, error, generatePdf } = usePdfExport();
  const [selected, setSelected] = useState<Set<SectionKey>>(
    new Set(SECTIONS.map((s) => s.key)),
  );

  function toggle(key: SectionKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleGenerate() {
    generatePdf(Array.from(selected));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Download a formatted PDF health summary suitable for sharing with doctors
        or storing offline. Choose which sections to include.
      </p>

      <div>
        <p
          className="mb-2 text-sm font-medium"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Include in PDF:
        </p>
        <ul className="grid grid-cols-2 gap-2">
          {SECTIONS.map(({ key, label }) => (
            <li key={key}>
              <label
                className="flex items-center gap-2 cursor-pointer select-none text-sm"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggle(key)}
                  disabled={generating}
                  style={{ accentColor: 'var(--color-sage)', width: 15, height: 15 }}
                />
                {label}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="pt-2">
        <button
          onClick={handleGenerate}
          disabled={generating || selected.size === 0}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          style={{
            backgroundColor: 'var(--color-terracotta)',
            color: '#fff',
            border: '1px solid var(--color-terracotta)',
          }}
          type="button"
        >
          {generating ? (
            <>
              <svg
                className="animate-spin h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Generating PDF…
            </>
          ) : (
            'Download Health Summary (PDF)'
          )}
        </button>
      </div>

      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{
            backgroundColor: '#2D1215',
            color: 'var(--color-terracotta)',
            border: '1px solid #991B1B',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
