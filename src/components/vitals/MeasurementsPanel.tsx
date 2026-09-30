'use client';

import React from 'react';
import { useVitals } from '@/hooks/useVitals';
import type { ActiveMetricGoal } from '@/lib/fitness/goal-direction';
import Skeleton from '@/components/shared/Skeleton';
import MeasurementsView from './MeasurementsView';

interface MeasurementsPanelProps {
  metricGoals?: readonly ActiveMetricGoal[];
  onAddManual?: () => void;
}

/**
 * Data container for the Measurements view.
 *
 * It reads the EXISTING `GET /api/vitals` endpoint with no date bounds rather
 * than reusing the page's shared range. Circumferences are sparse — the page
 * defaults to a one-month window, which would routinely hide the most recent
 * measurement session entirely. The view then filters that history
 * client-side for its own 3M/6M/1Y/All range, so the latest reading is always
 * present no matter which range is selected.
 */
export default function MeasurementsPanel({
  metricGoals,
  onAddManual,
}: MeasurementsPanelProps) {
  const { vitals, loading, error } = useVitals();

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-lg border px-4 py-3 text-sm"
        style={{
          backgroundColor: 'rgba(224, 122, 95, 0.12)',
          borderColor: 'var(--color-terracotta)',
          color: 'var(--color-terracotta)',
        }}
        role="alert"
      >
        {error}
      </div>
    );
  }

  return (
    <MeasurementsView
      vitals={vitals}
      metricGoals={metricGoals}
      onAddManual={onAddManual}
    />
  );
}
