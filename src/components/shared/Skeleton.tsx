'use client';

import React from 'react';

type SkeletonVariant = 'text' | 'circle' | 'card' | 'rect';

interface SkeletonProps {
  className?: string;
  variant?: SkeletonVariant;
}

const variantClasses: Record<SkeletonVariant, string> = {
  text: 'w-full h-4 rounded',
  circle: 'w-10 h-10 rounded-full',
  card: 'w-full h-[120px] rounded-xl',
  rect: 'w-full h-16 rounded-lg',
};

export default function Skeleton({ className = '', variant = 'text' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse ${variantClasses[variant]} ${className}`}
      style={{ backgroundColor: 'var(--color-cream)' }}
      aria-hidden="true"
    />
  );
}
