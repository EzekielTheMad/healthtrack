'use client';

import React, { type ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="mb-4" style={{ color: 'var(--color-text-muted)' }}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
        {title}
      </h3>
      <p className="text-sm max-w-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
        {description}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-6 py-2.5 rounded-full text-sm font-bold transition-all hover:-translate-y-0.5 cursor-pointer"
          style={{
            background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))',
            color: 'white',
            boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
