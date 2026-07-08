'use client';

import { useState } from 'react';
import { useProviders } from '@/hooks/useProviders';
import { ProviderCard } from './ProviderCard';
import EmptyState from '@/components/shared/EmptyState';
import type { Provider, ProviderType } from '@/lib/types';

const PROVIDER_TYPES: { value: ProviderType; label: string }[] = [
  { value: 'pcp', label: 'Primary Care' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'lab', label: 'Lab' },
  { value: 'imaging', label: 'Imaging' },
  { value: 'urgent_care', label: 'Urgent Care' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'therapist', label: 'Therapist' },
  { value: 'dentist', label: 'Dentist' },
  { value: 'other', label: 'Other' },
];

export function ProviderManagement() {
  const { providers, loading, addProvider, updateProvider, deleteProvider } = useProviders();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ProviderType>('pcp');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await addProvider({
        name: newName.trim(),
        provider_type: newType,
        specialty: null,
        organization: null,
        phone: null,
        fax: null,
        address: null,
        city: null,
        state: null,
        zip: null,
        portal_url: null,
        notes: null,
        is_favorite: false,
      });
      setNewName('');
      setShowAdd(false);
    } catch {
      // handled by hook
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-bg-card rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Providers</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-3 py-1.5 bg-accent-green text-bg-primary rounded-lg text-sm font-medium"
        >
          + Add Provider
        </button>
      </div>

      {showAdd && (
        <div className="bg-bg-card border border-border-card rounded-xl p-4 mb-4 space-y-3">
          <div>
            <label htmlFor="provider-name" className="block text-sm text-text-muted mb-1">
              Name *
            </label>
            <input
              id="provider-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 bg-bg-primary border border-border-card rounded-lg text-text-primary focus:outline-none focus:border-accent-green"
            />
          </div>
          <div>
            <label htmlFor="provider-type" className="block text-sm text-text-muted mb-1">
              Type *
            </label>
            <select
              id="provider-type"
              value={newType}
              onChange={(e) => setNewType(e.target.value as ProviderType)}
              className="w-full px-3 py-2 bg-bg-primary border border-border-card rounded-lg text-text-primary focus:outline-none focus:border-accent-green"
            >
              {PROVIDER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || saving}
              className="px-4 py-2 bg-accent-green text-bg-primary rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 border border-border-card rounded-lg text-sm text-text-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {providers.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-12 h-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
          title="No providers yet"
          description="Add your doctors, labs, and other healthcare providers."
          action={{ label: 'Add Provider', onClick: () => setShowAdd(true) }}
        />
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              onUpdate={updateProvider}
              onDelete={deleteProvider}
            />
          ))}
        </div>
      )}
    </div>
  );
}
