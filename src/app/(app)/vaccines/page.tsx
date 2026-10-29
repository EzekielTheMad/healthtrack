'use client';

import { useState } from 'react';
import { useVaccines } from '@/hooks/useVaccines';
import { useCapabilities } from '@/hooks/useCapabilities';
import VaccineCard from '@/components/vaccines/VaccineCard';
import AddVaccineForm, { type AddVaccineFormData } from '@/components/vaccines/AddVaccineForm';
import VaccineImport from '@/components/vaccines/VaccineImport';
import ImportBatchReview from '@/components/settings/ImportBatchReview';
import EmptyState from '@/components/shared/EmptyState';
import Skeleton from '@/components/shared/Skeleton';
import type { ParsedVaccinePdfResult } from '@/lib/claude/parse-vaccine-pdf';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { useSession } from '@/lib/auth/client';

type ViewMode = 'list' | 'add' | 'import' | 'review';

export default function VaccinesPage() {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const { data: session } = useSession();
  return (
    <PatientVaccinesPage key={JSON.stringify([session?.user.id, dependentId, delegateOwnerId])} />
  );
}
function PatientVaccinesPage() {
  const { capabilities } = useCapabilities();
  const { vaccines, loading, error, addVaccine, updateVaccine, deleteVaccine, refetch } =
    useVaccines();
  const [mode, setMode] = useState<ViewMode>('list');
  const [batchId, setBatchId] = useState<string | null>(null);

  const handleAdd = async (data: AddVaccineFormData) => {
    await addVaccine({
      name: data.name,
      cvx_code: data.cvx_code ?? null,
      vaccine_date: data.vaccine_date,
      dose_number: data.dose_number ?? null,
      series_doses: data.series_doses ?? null,
      manufacturer: data.manufacturer || null,
      lot_number: data.lot_number || null,
      provider_id: data.provider_id ?? null,
      next_dose_date: data.next_dose_date || null,
      notes: data.notes || null,
    });
    setMode('list');
  };

  const handleParsed = (results: ParsedVaccinePdfResult) => {
    if (!results.import_batch_id) return;
    setBatchId(results.import_batch_id);
    setMode('review');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Vaccines
        </h1>
        {mode === 'list' && (
          <div className="flex gap-2">
            {/* PDF import runs through the AI parser — hidden when unconfigured */}
            {capabilities?.ai !== false && (
              <button
                type="button"
                onClick={() => setMode('import')}
                className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--color-sage)',
                  border: '1px solid var(--color-sage)',
                }}
              >
                Import PDF
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode('add')}
              className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
              style={{
                background:
                  'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))',
                color: 'white',
                boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)',
              }}
            >
              Add Vaccine
            </button>
          </div>
        )}
      </div>

      {/* Import flow */}
      {mode === 'import' && (
        <div
          className="rounded-xl border p-5"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <VaccineImport onParsed={handleParsed} onCancel={() => setMode('list')} />
        </div>
      )}

      {/* Review parsed records */}
      {mode === 'review' && batchId && (
        <ImportBatchReview
          batchId={batchId}
          onComplete={() => {
            setBatchId(null);
            setMode('list');
            void refetch();
          }}
          onCancel={() => {
            setBatchId(null);
            setMode('list');
          }}
        />
      )}

      {/* Manual add form */}
      {mode === 'add' && (
        <div
          className="rounded-xl border p-5"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
            New Vaccine
          </h2>
          <AddVaccineForm onSubmit={handleAdd} onCancel={() => setMode('list')} />
        </div>
      )}

      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(224, 122, 95, 0.15)',
            color: 'var(--color-terracotta)',
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : vaccines.length === 0 ? (
        <div
          className="rounded-xl border"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <EmptyState
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-10 w-10"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.75 3v2.25M14.25 3v2.25M9.75 21v-2.25M14.25 21v-2.25M3 9.75h2.25M3 14.25h2.25M21 9.75h-2.25M21 14.25h-2.25M7.5 7.5h9v9h-9z"
                />
              </svg>
            }
            title="No vaccines recorded"
            description="Track your vaccination history by adding records manually or importing a PDF."
            action={{ label: 'Add Vaccine', onClick: () => setMode('add') }}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {vaccines.map((vax) => (
            <VaccineCard
              key={vax.id}
              vaccine={vax}
              onUpdate={updateVaccine}
              onDelete={deleteVaccine}
            />
          ))}
        </div>
      )}
    </div>
  );
}
