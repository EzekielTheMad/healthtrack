'use client';

import { useState, useRef, useEffect } from 'react';
import { useProviders } from '@/hooks/useProviders';
import type { Provider, ProviderType } from '@/lib/types';

interface ProviderPickerProps {
  value: string | null;
  onChange: (providerId: string | null) => void;
  label?: string;
}

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

export function ProviderPicker({ value, onChange, label = 'Provider' }: ProviderPickerProps) {
  const { providers, addProvider } = useProviders();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ProviderType>('pcp');
  const [adding, setAdding] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = providers.find((p) => p.id === value);

  const filtered = providers.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.specialty && p.specialty.toLowerCase().includes(search.toLowerCase())) ||
      (p.organization && p.organization.toLowerCase().includes(search.toLowerCase()))
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowAddForm(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const provider = await addProvider({
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
      onChange(provider.id);
      setShowAddForm(false);
      setIsOpen(false);
      setNewName('');
    } catch {
      // Error handled by hook
    } finally {
      setAdding(false);
    }
  };

  return (
    <div ref={dropdownRef} className="relative" role="combobox" aria-expanded={isOpen} aria-haspopup="listbox">
      <label className="block text-sm font-medium text-text-muted mb-1">{label}</label>
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="w-full text-left px-3 py-2.5 rounded-xl border border-border-card bg-bg-card text-text-primary hover:border-accent-green/50 transition-colors"
      >
        {selected ? (
          <span>
            {selected.name}
            {selected.provider_type && (
              <span className="ml-2 text-xs text-text-muted">({selected.provider_type})</span>
            )}
          </span>
        ) : (
          <span className="text-text-muted">Select a provider...</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-bg-card border border-border-card rounded-xl shadow-lg max-h-64 overflow-y-auto flex flex-col">
          <div className="p-2 border-b border-border-card">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search providers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 bg-bg-primary border border-border-card rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent-green"
              aria-label="Search providers"
            />
          </div>
          <ul className="max-h-32 overflow-y-auto flex-shrink" role="listbox">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-bg-primary transition-colors ${
                    p.id === value ? 'bg-bg-primary' : ''
                  }`}
                  role="option"
                  aria-selected={p.id === value}
                >
                  <div className="flex items-center gap-2">
                    {p.is_favorite && <span className="text-accent-yellow text-xs">★</span>}
                    <span className="text-sm text-text-primary">{p.name}</span>
                    {p.provider_type && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-bg-primary text-text-muted">
                        {p.provider_type}
                      </span>
                    )}
                  </div>
                  {p.organization && (
                    <div className="text-xs text-text-muted ml-5">{p.organization}</div>
                  )}
                </button>
              </li>
            ))}
            {filtered.length === 0 && !showAddForm && (
              <li className="px-3 py-2 text-sm text-text-muted">No providers found</li>
            )}
          </ul>
          <div className="border-t border-border-card">
            {showAddForm ? (
              <div className="p-3 space-y-2">
                <input
                  type="text"
                  placeholder="Provider name *"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-primary border border-border-card rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent-green"
                  aria-label="New provider name"
                />
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as ProviderType)}
                  className="w-full px-3 py-2 bg-bg-primary border border-border-card rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent-green"
                  aria-label="Provider type"
                >
                  {PROVIDER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!newName.trim() || adding}
                    className="flex-1 px-3 py-1.5 bg-accent-green text-bg-primary rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {adding ? 'Adding...' : 'Add'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-3 py-1.5 border border-border-card rounded-lg text-sm text-text-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="w-full px-3 py-2 text-left text-sm text-accent-green hover:bg-bg-primary transition-colors"
              >
                + Add new provider
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
