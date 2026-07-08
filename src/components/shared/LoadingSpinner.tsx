'use client';

import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 16,
  md: 24,
  lg: 40,
};

export default function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  const px = sizeMap[size];

  return (
    <div
      className={`inline-block animate-spin rounded-full ${className}`}
      style={{
        width: px,
        height: px,
        border: `${size === 'sm' ? 2 : 3}px solid var(--color-soft-peach)`,
        borderTopColor: 'var(--color-sage)',
      }}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}
