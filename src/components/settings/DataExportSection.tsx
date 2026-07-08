'use client';

import { useSyncExternalStore } from 'react';
import { useExport } from '@/hooks/useExport';

const LAST_EXPORT_KEY = 'healthtrack_last_export';

// localStorage is an external store: subscribe to cross-tab writes via the
// `storage` event; same-tab writes (useExport) flip `exporting`, which
// re-renders and re-reads the snapshot.
function subscribeToStorage(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getLastExportSnapshot() {
  return localStorage.getItem(LAST_EXPORT_KEY);
}

function getLastExportServerSnapshot() {
  return null;
}

const INCLUDED_DATA = [
  'Profile',
  'Medications',
  'Conditions',
  'Lab results',
  'Vitals (last 90 days)',
  'Appointments',
  'Notes',
  'Providers',
];

export default function DataExportSection() {
  const { exporting, error, exportData } = useExport();
  const lastExport = useSyncExternalStore(
    subscribeToStorage,
    getLastExportSnapshot,
    getLastExportServerSnapshot,
  );

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Download a copy of all your health data as a structured JSON file.
        This export includes everything stored in your account so you always
        have a personal backup.
      </p>

      <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        <p className="mb-2 font-medium" style={{ color: 'var(--color-text-primary)' }}>
          Included in export:
        </p>
        <ul className="grid grid-cols-2 gap-1">
          {INCLUDED_DATA.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span style={{ color: 'var(--color-sage)' }}>&#10003;</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-4 pt-2">
        <button
          onClick={() => exportData('json')}
          disabled={exporting}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: exporting ? 'var(--border-card)' : 'var(--color-sage)',
            color: 'var(--color-sage)',
            border: '1px solid #16a34a',
          }}
        >
          {exporting ? (
            <span className="flex items-center gap-2">
              <svg
                className="animate-spin h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
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
              Exporting…
            </span>
          ) : (
            'Export as JSON'
          )}
        </button>

        {lastExport && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Last export: {new Date(lastExport).toLocaleDateString()}
          </span>
        )}
      </div>

      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{ backgroundColor: '#2D1215', color: 'var(--color-terracotta)', border: '1px solid #991B1B' }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
