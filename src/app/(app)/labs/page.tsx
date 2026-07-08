'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useLabResults } from '@/hooks/useLabResults';
import { useCapabilities } from '@/hooks/useCapabilities';
import type { ParsedLabResult } from '@/lib/claude/parse-lab';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import LabImport from '@/components/labs/LabImport';
import LabValidationReview from '@/components/labs/LabValidationReview';
import TrendCard from '@/components/labs/TrendCard';
import VisitCard from '@/components/labs/VisitCard';

type View = 'trends' | 'visits';
type Flow = 'idle' | 'import' | 'review';

export default function LabsPage() {
  const { capabilities } = useCapabilities();
  // PDF import runs through the AI parser — hide its entry points when the
  // instance has no ANTHROPIC_API_KEY configured.
  const aiHidden = capabilities?.ai === false;
  const { labVisits, loading, error, saveLabVisit } = useLabResults();
  const [tab, setTab] = useState<View>('visits');
  const [flow, setFlow] = useState<Flow>('idle');
  const [parsedData, setParsedData] = useState<ParsedLabResult | null>(null);
  const [storagePath, setStoragePath] = useState<string>('');

  // Handle parsed results from LabImport
  const handleParsed = useCallback(
    (results: ParsedLabResult, path: string) => {
      setParsedData(results);
      setStoragePath(path);
      setFlow('review');
    },
    [],
  );

  // Save validated results
  const handleSave = useCallback(
    async (data: ParsedLabResult, path: string) => {
      await saveLabVisit(data, path);
      setFlow('idle');
      setParsedData(null);
      setStoragePath('');
    },
    [saveLabVisit],
  );

  // Re-parse: go back to import
  const handleReparse = useCallback(() => {
    setFlow('import');
    setParsedData(null);
    setStoragePath('');
  }, []);

  // Cancel review
  const handleCancel = useCallback(() => {
    setFlow('idle');
    setParsedData(null);
    setStoragePath('');
  }, []);

  // Build trend data: group all results by test_name, sorted by visit_date
  const trendData = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        value: number;
        visit_date: string;
        flag: string | null;
        ref_low: number | null;
        ref_high: number | null;
      }>
    >();

    for (const visit of labVisits) {
      for (const result of visit.lab_results) {
        const key = result.test_name;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({
          value: result.value,
          visit_date: visit.visit_date,
          flag: result.flag,
          ref_low: result.reference_range_low,
          ref_high: result.reference_range_high,
        });
      }
    }

    // Sort each test's results by visit_date
    for (const [, points] of map) {
      points.sort(
        (a, b) =>
          new Date(a.visit_date).getTime() - new Date(b.visit_date).getTime(),
      );
    }

    return map;
  }, [labVisits]);

  type TrendPoint = {
    value: number;
    visit_date: string;
    flag: string | null;
    ref_low: number | null;
    ref_high: number | null;
  };

  // Split trends into "Needs Attention" and "Within Range"
  const { needsAttention, withinRange } = useMemo(() => {
    const attention: Array<{ testName: string; results: TrendPoint[] }> = [];
    const normal: Array<{ testName: string; results: TrendPoint[] }> = [];

    for (const [testName, results] of trendData) {
      const hasFlagged = results.some((r) => r.flag && r.flag !== 'normal');
      if (hasFlagged) {
        attention.push({ testName, results });
      } else {
        normal.push({ testName, results });
      }
    }

    return { needsAttention: attention, withinRange: normal };
  }, [trendData]);

  // Visit cards data: map lab_results key to results for VisitCard
  const visitCards = useMemo(
    () =>
      labVisits.map((v) => ({
        ...v,
        results: v.lab_results,
      })),
    [labVisits],
  );

  const hasResults = labVisits.length > 0;

  // Render import flow
  if (flow === 'import') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            Upload Lab Report
          </h1>
          <button
            onClick={handleCancel}
            className="text-sm cursor-pointer hover:opacity-80"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Cancel
          </button>
        </div>
        <LabImport onParsed={handleParsed} />
      </div>
    );
  }

  // Render review flow
  if (flow === 'review' && parsedData) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Review Parsed Results
        </h1>
        <LabValidationReview
          parsedData={parsedData}
          storagePath={storagePath}
          onSave={handleSave}
          onReparse={handleReparse}
          onCancel={handleCancel}
        />
      </div>
    );
  }

  // Main view
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Lab Results
        </h1>
        {!aiHidden && (
          <button
            onClick={() => setFlow('import')}
            className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors"
            style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
          >
            Upload Lab PDF
          </button>
        )}
      </div>

      {/* Tab toggle */}
      <div className="flex gap-2">
        {(['trends', 'visits'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize cursor-pointer"
            style={{
              backgroundColor: tab === t ? 'var(--color-sage)' : 'var(--bg-card)',
              color: tab === t ? 'var(--bg-primary)' : 'var(--color-text-muted)',
              border: tab === t ? 'none' : '1px solid #1E2642',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(224, 122, 95, 0.1)',
            color: 'var(--color-terracotta)',
            border: '1px solid rgba(248,113,113,0.2)',
          }}
        >
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !hasResults && (
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
                  d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5"
                />
              </svg>
            }
            title="No lab results yet"
            description={
              aiHidden
                ? 'Lab results imported on this instance will appear here.'
                : "Upload a lab PDF to get started. We'll parse your results and track trends over time."
            }
            action={
              aiHidden
                ? undefined
                : {
                    label: 'Upload Lab PDF',
                    onClick: () => setFlow('import'),
                  }
            }
          />
        </div>
      )}

      {/* Trends View */}
      {!loading && !error && hasResults && tab === 'trends' && (
        <div className="space-y-8">
          {needsAttention.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-terracotta)' }}>
                Needs Attention
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {needsAttention.map(({ testName, results: pts }) => (
                  <TrendCard key={testName} testName={testName} results={pts} />
                ))}
              </div>
            </section>
          )}
          {withinRange.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--color-sage)' }}>
                Within Range
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {withinRange.map(({ testName, results: pts }) => (
                  <TrendCard key={testName} testName={testName} results={pts} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Visits View */}
      {!loading && !error && hasResults && tab === 'visits' && (
        <div className="space-y-4">
          {visitCards.map((visit) => (
            <VisitCard key={visit.id} visit={visit} />
          ))}
        </div>
      )}
    </div>
  );
}
