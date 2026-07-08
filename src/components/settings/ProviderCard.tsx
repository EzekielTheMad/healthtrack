'use client';

import { useState } from 'react';
import type { Provider } from '@/lib/types';

interface ProviderCardProps {
  provider: Provider;
  onUpdate: (id: string, updates: Partial<Provider>) => Promise<Provider>;
  onDelete: (id: string) => Promise<void>;
}

export function ProviderCard({ provider, onUpdate, onDelete }: ProviderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleFavorite = async () => {
    await onUpdate(provider.id, { is_favorite: !provider.is_favorite });
  };

  const handleDelete = async () => {
    if (!confirm('Delete this provider? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await onDelete(provider.id);
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-bg-card border border-border-card rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 flex items-center justify-between hover:bg-bg-primary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleFavorite();
            }}
            className={`text-lg ${provider.is_favorite ? 'text-accent-yellow' : 'text-text-dim'}`}
            aria-label={provider.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            ★
          </button>
          <div>
            <div className="font-medium">{provider.name}</div>
            <div className="flex items-center gap-2 text-sm text-text-muted">
              {provider.provider_type && (
                <span className="px-1.5 py-0.5 rounded bg-bg-primary text-xs">
                  {provider.provider_type}
                </span>
              )}
              {provider.specialty && <span>{provider.specialty}</span>}
              {provider.organization && <span>· {provider.organization}</span>}
            </div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border-card pt-3 space-y-2 text-sm">
          {provider.phone && (
            <div className="flex justify-between">
              <span className="text-text-muted">Phone</span>
              <span>{provider.phone}</span>
            </div>
          )}
          {provider.address && (
            <div className="flex justify-between">
              <span className="text-text-muted">Address</span>
              <span>
                {provider.address}
                {provider.city && `, ${provider.city}`}
                {provider.state && ` ${provider.state}`}
                {provider.zip && ` ${provider.zip}`}
              </span>
            </div>
          )}
          {provider.portal_url && (
            <div className="flex justify-between">
              <span className="text-text-muted">Portal</span>
              <a
                href={provider.portal_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-blue hover:underline"
              >
                Open Portal
              </a>
            </div>
          )}
          {provider.notes && (
            <div>
              <span className="text-text-muted">Notes: </span>
              <span>{provider.notes}</span>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-accent-red border border-accent-red/30 rounded-lg text-xs hover:bg-accent-red/10 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
