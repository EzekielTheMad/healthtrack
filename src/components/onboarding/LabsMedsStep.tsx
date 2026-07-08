'use client';

import { useState, useCallback, type DragEvent } from 'react';
import { apiFetch } from '@/lib/api/client';

interface LabsMedsStepProps {
  onNext: () => void;
  onBack: () => void;
}

interface QuickMedication {
  name: string;
  dosage: string;
  frequency: string;
}

const FREQUENCY_OPTIONS = [
  { value: 'once_daily', label: 'Once daily' },
  { value: 'twice_daily', label: 'Twice daily' },
  { value: 'three_times_daily', label: 'Three times daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'as_needed', label: 'As needed' },
] as const;

export function LabsMedsStep({ onNext }: LabsMedsStepProps) {
  const [medications, setMedications] = useState<QuickMedication[]>([]);
  const [medName, setMedName] = useState('');
  const [medDosage, setMedDosage] = useState('');
  const [medFrequency, setMedFrequency] = useState('once_daily');
  const [addingMed, setAddingMed] = useState(false);
  const [medError, setMedError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleAddMedication = async () => {
    if (!medName.trim()) {
      setMedError('Medication name is required.');
      return;
    }

    setAddingMed(true);
    setMedError(null);

    try {
      await apiFetch('/api/medications', {
        method: 'POST',
        body: JSON.stringify({
          name: medName.trim(),
          dosage: medDosage.trim() || null,
          frequency: medFrequency,
          start_date: new Date().toISOString().split('T')[0],
        }),
      });

      setMedications((prev) => [
        ...prev,
        { name: medName.trim(), dosage: medDosage.trim(), frequency: medFrequency },
      ]);
      setMedName('');
      setMedDosage('');
      setMedFrequency('once_daily');
    } catch (err) {
      setMedError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setAddingMed(false);
    }
  };

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    // Phase 2: handle file upload
  }, []);

  const handleFinish = async () => {
    setFinishing(true);
    // NOTE: the old code set profiles.onboarding_completed here, but that
    // column has never existed in any migration — the update silently failed
    // against the old backend and is intentionally dropped in the port.
    onNext();
    setFinishing(false);
  };

  const inputClasses =
    'w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors focus:ring-2 focus:ring-accent-green/40';
  const inputStyle = {
    backgroundColor: 'var(--bg-primary)',
    borderWidth: 1,
    borderColor: 'var(--border-card)',
    color: 'var(--color-text-primary)',
  };
  const labelStyle = { color: 'var(--color-text-primary)' };

  const frequencyLabel = (value: string) =>
    FREQUENCY_OPTIONS.find((opt) => opt.value === value)?.label ?? value;

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
        Labs & Medications
      </h2>
      <p className="text-sm mb-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
        Add your lab results and current medications.
      </p>

      {/* Upload Lab Results */}
      <div className="w-full mb-8">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
          Upload Lab Results
        </h3>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors cursor-default"
          style={{
            borderColor: dragOver ? 'var(--color-sage)' : 'var(--border-card)',
            backgroundColor: dragOver ? 'rgba(129, 178, 154, 0.05)' : 'var(--bg-card)',
          }}
          role="region"
          aria-label="File upload drop zone"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: 'var(--color-text-muted)' }} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm mb-1" style={{ color: 'var(--color-text-muted)' }}>
            Drag and drop PDF, PNG, or JPG files
          </p>
          <p className="text-xs font-medium px-3 py-1 rounded-full" style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-sage)' }}>
            Coming in Phase 2
          </p>
        </div>
      </div>

      {/* Quick Medication Entry */}
      <div className="w-full mb-8">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
          Quick Medication Entry
        </h3>
        <div
          className="rounded-xl border p-5 space-y-4"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <div>
            <label htmlFor="med_name" className="block text-sm font-medium mb-1.5" style={labelStyle}>
              Medication Name
            </label>
            <input
              id="med_name"
              type="text"
              value={medName}
              onChange={(e) => setMedName(e.target.value)}
              className={inputClasses}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor="med_dosage" className="block text-sm font-medium mb-1.5" style={labelStyle}>
              Dosage
            </label>
            <input
              id="med_dosage"
              type="text"
              value={medDosage}
              onChange={(e) => setMedDosage(e.target.value)}
              placeholder="e.g. 500mg"
              className={inputClasses}
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor="med_frequency" className="block text-sm font-medium mb-1.5" style={labelStyle}>
              Frequency
            </label>
            <select
              id="med_frequency"
              value={medFrequency}
              onChange={(e) => setMedFrequency(e.target.value)}
              className={inputClasses}
              style={inputStyle}
            >
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {medError && (
            <p className="text-xs" style={{ color: 'var(--color-terracotta)' }} role="alert">
              {medError}
            </p>
          )}

          <button
            type="button"
            onClick={handleAddMedication}
            disabled={addingMed}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-sage)' }}
          >
            {addingMed ? 'Adding...' : 'Add Medication'}
          </button>
        </div>

        {/* Added medications list */}
        {medications.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
              Added medications
            </p>
            <ul className="space-y-2" aria-label="Added medications">
              {medications.map((med, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-lg border px-4 py-3"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--color-sage)' }} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {med.name}
                      {med.dosage && (
                        <span className="font-normal" style={{ color: 'var(--color-text-muted)' }}>
                          {' '}
                          &mdash; {med.dosage}
                        </span>
                      )}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {frequencyLabel(med.frequency)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Finish button */}
      <button
        type="button"
        onClick={handleFinish}
        disabled={finishing}
        className="px-8 py-3 rounded-lg font-medium text-sm transition-colors hover:opacity-90 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
      >
        {finishing ? 'Finishing...' : 'Finish Setup'}
      </button>
    </div>
  );
}
