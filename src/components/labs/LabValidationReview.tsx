'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type {
  ParsedLabResult,
  ParsedLabResultItem,
} from '@/lib/claude/parse-lab';
import FlagBadge from '@/components/shared/FlagBadge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { AI_DISCLAIMER } from '@/lib/ai-disclaimer';
import type { Flag } from '@/lib/types';

interface LabValidationReviewProps {
  parsedData: ParsedLabResult;
  storagePath: string;
  onSave: (data: ParsedLabResult, storagePath: string) => Promise<void>;
  onReparse: () => void;
  onCancel: () => void;
}

function autoFlag(
  value: number,
  low: number | null,
  high: number | null,
): 'normal' | 'high' | 'low' | null {
  if (low === null && high === null) return null;
  if (low !== null && value < low) return 'low';
  if (high !== null && value > high) return 'high';
  return 'normal';
}

function WarningIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="inline-block ml-1"
      style={{ width: 14, height: 14, color: 'var(--color-warning)' }}
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.345 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function LabValidationReview({
  parsedData,
  storagePath,
  onSave,
  onReparse,
  onCancel,
}: LabValidationReviewProps) {
  const [visitDate, setVisitDate] = useState(parsedData.visit_date ?? '');
  const [providerName, setProviderName] = useState(
    parsedData.provider_name ?? '',
  );
  const [results, setResults] = useState<ParsedLabResultItem[]>(
    () => [...parsedData.results],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateResult = useCallback(
    (index: number, field: keyof ParsedLabResultItem, rawValue: string) => {
      setResults((prev) => {
        const updated = [...prev];
        const row = { ...updated[index] };

        if (field === 'value' || field === 'reference_range_low' || field === 'reference_range_high') {
          const num = rawValue === '' ? null : parseFloat(rawValue);
          if (field === 'value') {
            row.value = num ?? 0;
          } else {
            (row as Record<string, unknown>)[field] = num;
          }
          // Auto-recalculate flag
          const computed = autoFlag(
            row.value,
            row.reference_range_low,
            row.reference_range_high,
          );
          if (computed !== null) {
            row.flag = computed;
          }
        } else if (field === 'flag') {
          row.flag = (rawValue as ParsedLabResultItem['flag']) || null;
        } else if (field === 'confidence') {
          row.confidence = rawValue as ParsedLabResultItem['confidence'];
        } else {
          (row as Record<string, unknown>)[field] = rawValue || null;
        }

        updated[index] = row;
        return updated;
      });
    },
    [],
  );

  const addRow = useCallback(() => {
    setResults((prev) => [
      ...prev,
      {
        panel_name: null,
        test_name: '',
        value: 0,
        unit: '',
        reference_range_low: null,
        reference_range_high: null,
        reference_range_text: null,
        flag: null,
        confidence: 'low' as const,
      },
    ]);
  }, []);

  const removeRow = useCallback((index: number) => {
    setResults((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          visit_date: visitDate || null,
          provider_name: providerName || null,
          results,
        },
        storagePath,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [onSave, visitDate, providerName, results, storagePath]);

  const summary = useMemo(() => {
    const panels = new Set(results.map((r) => r.panel_name).filter(Boolean));
    const flagged = results.filter(
      (r) => r.flag && r.flag !== 'normal',
    ).length;
    return {
      resultCount: results.length,
      panelCount: panels.size,
      flaggedCount: flagged,
    };
  }, [results]);

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--border-card)',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 13,
    width: '100%',
  };

  return (
    <div className="space-y-6">
      {/* AI extraction disclaimer */}
      <div
        className="rounded-lg px-4 py-3 text-sm"
        style={{
          backgroundColor: 'rgba(233, 196, 106, 0.08)',
          borderLeft: '3px solid var(--color-warning)',
          color: 'var(--color-text-primary)',
        }}
      >
        AI-extracted values can contain errors. Check each value against your
        original report before saving. {AI_DISCLAIMER}
      </div>

      {/* Header fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            className="block text-xs font-medium mb-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Visit Date
          </label>
          <input
            type="date"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <label
            className="block text-xs font-medium mb-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Provider / Lab Name
          </label>
          <input
            type="text"
            value={providerName}
            onChange={(e) => setProviderName(e.target.value)}
            placeholder="e.g. Quest Diagnostics"
            style={inputStyle}
          />
        </div>
      </div>

      {/* Results table */}
      <div
        className="rounded-xl border overflow-x-auto"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <table className="w-full text-sm" style={{ minWidth: 900 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-card)' }}>
              {['Panel', 'Test Name', 'Value', 'Unit', 'Ref Low', 'Ref High', 'Flag', 'Conf.', ''].map(
                (header) => (
                  <th
                    key={header}
                    className="text-left px-3 py-2 text-xs font-medium"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {header}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {results.map((row, i) => (
              <tr
                key={i}
                style={{ borderBottom: '1px solid var(--border-card)' }}
              >
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={row.panel_name ?? ''}
                    onChange={(e) => updateResult(i, 'panel_name', e.target.value)}
                    style={{ ...inputStyle, width: 120 }}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={row.test_name}
                    onChange={(e) => updateResult(i, 'test_name', e.target.value)}
                    style={{ ...inputStyle, width: 150 }}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center">
                    <input
                      type="number"
                      step="any"
                      value={row.value}
                      onChange={(e) => updateResult(i, 'value', e.target.value)}
                      style={{ ...inputStyle, width: 80 }}
                    />
                    {row.confidence !== 'high' && <WarningIcon />}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={row.unit}
                    onChange={(e) => updateResult(i, 'unit', e.target.value)}
                    style={{ ...inputStyle, width: 70 }}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="any"
                    value={row.reference_range_low ?? ''}
                    onChange={(e) =>
                      updateResult(i, 'reference_range_low', e.target.value)
                    }
                    style={{ ...inputStyle, width: 70 }}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="any"
                    value={row.reference_range_high ?? ''}
                    onChange={(e) =>
                      updateResult(i, 'reference_range_high', e.target.value)
                    }
                    style={{ ...inputStyle, width: 70 }}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={row.flag ?? ''}
                    onChange={(e) => updateResult(i, 'flag', e.target.value)}
                    style={{ ...inputStyle, width: 90 }}
                  >
                    <option value="">--</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="low">Low</option>
                    <option value="critical">Critical</option>
                  </select>
                  {row.flag && row.flag !== 'normal' && (
                    <span className="ml-1">
                      <FlagBadge flag={row.flag as Flag} />
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className="text-xs font-medium"
                    style={{
                      color:
                        row.confidence === 'high'
                          ? 'var(--color-sage)'
                          : row.confidence === 'medium'
                          ? 'var(--color-warning)'
                          : 'var(--color-terracotta)',
                    }}
                  >
                    {row.confidence}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => removeRow(i)}
                    className="text-xs cursor-pointer hover:opacity-80"
                    style={{ color: 'var(--color-terracotta)' }}
                    type="button"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add row */}
      <button
        onClick={addRow}
        type="button"
        className="text-sm font-medium cursor-pointer hover:opacity-80"
        style={{ color: 'var(--color-sage)' }}
      >
        + Add Row
      </button>

      {/* Summary */}
      <div
        className="rounded-lg px-4 py-3 text-sm"
        style={{
          backgroundColor: 'rgba(96,165,250,0.1)',
          color: 'var(--color-sage)',
          border: '1px solid rgba(96,165,250,0.2)',
        }}
      >
        {summary.resultCount} results across {summary.panelCount} panel
        {summary.panelCount !== 1 ? 's' : ''}, {summary.flaggedCount} flagged
      </div>

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

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleSave}
          disabled={saving || results.length === 0}
          className="px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <LoadingSpinner size="sm" />
              Saving...
            </span>
          ) : (
            'Save to Health Record'
          )}
        </button>
        <button
          onClick={onReparse}
          disabled={saving}
          className="px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-sage)',
            border: '1px solid var(--border-card)',
          }}
        >
          Re-parse
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--border-card)',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
