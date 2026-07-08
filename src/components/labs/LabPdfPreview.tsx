'use client';

/**
 * Expandable inline preview of a stored lab document. `storagePath` is the
 * value persisted in lab_visits.source_pdf_path (`<userId>/<uuid>.<ext>`),
 * streamed from GET /api/files/<storagePath>, which authorizes the request
 * against the owning lab visit (owner / accepted share / delegate).
 *
 * Note: this component was unreferenced even before the self-hosted
 * migration (the legacy bucket version had no call sites); it is kept
 * functional as the wiring point for lab PDF previews.
 */
import React, { useState } from 'react';

interface LabPdfPreviewProps {
  storagePath: string;
}

export default function LabPdfPreview({ storagePath }: LabPdfPreviewProps) {
  const [expanded, setExpanded] = useState(false);

  if (!storagePath) {
    return (
      <div
        className="rounded-lg px-4 py-3 text-sm"
        style={{
          color: 'var(--color-text-muted)',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
        }}
      >
        Unable to load PDF preview
      </div>
    );
  }

  const url = `/api/files/${storagePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-2 text-sm font-medium cursor-pointer hover:opacity-80"
        style={{ color: 'var(--color-sage)' }}
        type="button"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          style={{ width: 16, height: 16 }}
          className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
            clipRule="evenodd"
          />
        </svg>
        {expanded ? 'Hide PDF Preview' : 'Show PDF Preview'}
      </button>

      {expanded && (
        <div
          className="rounded-lg overflow-hidden border"
          style={{ borderColor: 'var(--border-card)' }}
        >
          <iframe
            src={url}
            title="Lab PDF Preview"
            className="w-full"
            style={{ height: 500, backgroundColor: '#fff' }}
          />
        </div>
      )}
    </div>
  );
}
