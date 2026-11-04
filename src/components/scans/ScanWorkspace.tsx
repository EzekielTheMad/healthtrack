'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ZodError } from 'zod';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import {
  SCAN_METRICS,
  getScanMetric,
  scanMetricUnits,
  isSourceDefinedScanMetric,
} from '@/lib/metrics/scan-registry';
import { normalizeScanMeasurements } from '@/lib/metrics/scan-normalization';
import {
  scanInputSchema,
  formatClinicalDate,
  type BodyScan,
  type ScanInput,
  type ClinicalDate,
} from '@/lib/fidelity/contracts';
import { selectCoherentScan } from '@/lib/fidelity/scan-selection';
import {
  scanDeviceKey,
  scanMetricDelta,
  scanComparisonWarnings,
  scanMetricComparisonWarnings,
  scanEvidenceRows,
} from '@/lib/fidelity/scan-presentation';
import type { VitalSourcePreferences } from '@/lib/metrics/source-selection';
import VendorResultsFields, { emptyVendorResults, parseVendorResults } from './VendorResultsFields';
import { emptySourceDraft, SourceReferences, SupplementLinks } from './ScanEvidenceFields';

const card = {
  backgroundColor: 'var(--bg-card)',
  borderColor: 'var(--border-card)',
  color: 'var(--color-text-primary)',
};
const control = 'min-h-11 w-full rounded-lg border px-3 py-2 text-sm';
const controlStyle = {
  backgroundColor: 'var(--bg-primary)',
  borderColor: 'var(--border-card)',
  color: 'var(--color-text-primary)',
};
const scanMetrics = SCAN_METRICS;
type MetricDraft = { metric: string; value: string; unit: string; definition?: string };
type History = {
  scans: BodyScan[];
  preferences: VitalSourcePreferences;
  latest: ReturnType<typeof selectCoherentScan>;
  coverage: { history_may_be_truncated: boolean };
};
type Outcome = { id: string; result: string; message?: string };
function defaultUnit(key: string) {
  const metric = getScanMetric(key);
  return metric?.unit === 'lbs' ? 'kg' : (metric?.unit ?? 'unitless');
}
function sessionLabel(row: BodyScan) {
  return `${formatClinicalDate(row.scan.measured_at)} · ${row.scan.source} · ${row.scan.model || 'Model unknown'} · ${row.scan.external_id}`;
}
function errorMessage(error: unknown) {
  if (error instanceof ZodError)
    return error.issues
      .map((issue) => `${issue.path.join('.') || 'Scan'}: ${issue.message}`)
      .join('; ');
  return error instanceof Error ? error.message : 'The scan could not be saved.';
}
/** Display only: retain scientific notation rather than rounding tiny nonzero values to zero. */
export function formatScanComparisonValue(value: number, signed = false): string {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value === 0) return '0';
  const rounded = Number(value.toPrecision(6));
  return `${rounded !== value ? '≈ ' : ''}${signed && rounded > 0 ? '+' : ''}${rounded}`;
}
export function scanMeasurementLabel(metricKey: string, estimated: boolean): string {
  const label = getScanMetric(metricKey)?.label ?? metricKey;
  return estimated && !/\bestimat(?:e|ed|es)\b/i.test(label) ? `${label} · estimate` : label;
}
function requestScope(ownerId: string | null, dependentId: string | null) {
  return {
    ...(ownerId ? { owner_id: ownerId } : {}),
    ...(dependentId ? { dependent_id: dependentId } : {}),
  };
}

export default function ScanPage() {
  const { dependentId, delegateOwnerId, delegatePermission } = useActiveProfile();
  const canWrite =
    !delegateOwnerId || delegatePermission === 'read_write' || delegatePermission === 'admin';
  return (
    <ScanWorkspace
      key={JSON.stringify([delegateOwnerId, dependentId])}
      ownerId={delegateOwnerId}
      dependentId={dependentId}
      canWrite={canWrite}
    />
  );
}
export function ScanWorkspace({
  ownerId,
  dependentId,
  canWrite,
}: {
  ownerId: string | null;
  dependentId: string | null;
  canWrite: boolean;
}) {
  const [rows, setRows] = useState<BodyScan[]>([]);
  const [preferences, setPreferences] = useState<VitalSourcePreferences>({});
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedSource, setSelectedSource] = useState('');
  const [currentId, setCurrentId] = useState('');
  const [baselineId, setBaselineId] = useState('');
  const [mode, setMode] = useState<'manual' | 'json'>('manual');
  const [source, setSource] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [method, setMethod] = useState<ScanInput['method']>('bia');
  const [externalId, setExternalId] = useState('');
  const [precision, setPrecision] = useState<ClinicalDate['precision']>('unknown');
  const [date, setDate] = useState('');
  const [dateText, setDateText] = useState('');
  const [timezone, setTimezone] = useState('');
  const [approximate, setApproximate] = useState(false);
  const [workout, setWorkout] = useState<'pre_workout' | 'post_workout' | 'unknown'>('unknown');
  const [fasting, setFasting] = useState<'fasted' | 'fed' | 'unknown'>('unknown');
  const [notes, setNotes] = useState('');
  const [workoutAt, setWorkoutAt] = useState('');
  const [workoutTimezone, setWorkoutTimezone] = useState('');
  const [supplementIds, setSupplementIds] = useState<string[]>([]);
  const [sources, setSources] = useState([emptySourceDraft()]);
  const [vendor, setVendor] = useState(emptyVendorResults);
  const [metrics, setMetrics] = useState<MetricDraft[]>([
    { metric: 'skeletal_muscle_mass', value: '', unit: 'kg' },
  ]);
  const [json, setJson] = useState('');
  const [preview, setPreview] = useState<ScanInput[] | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [chartMetric, setChartMetric] = useState('skeletal_muscle_mass');
  const scope = requestScope(ownerId, dependentId);
  useEffect(() => {
    let canceled = false;
    const params = new URLSearchParams({ ...requestScope(ownerId, dependentId), limit: '100' });
    const focusedId = window.location.hash.startsWith('#scan-')
      ? window.location.hash.slice(6)
      : '';
    if (focusedId) params.set('scan_id', focusedId);
    apiFetch<History>('/api/scans?' + params)
      .then((data) => {
        if (canceled) return;
        setRows(data.scans);
        setPreferences(data.preferences);
        setTruncated(data.coverage.history_may_be_truncated);
        setHistoryError(null);
        const focused = data.scans.find((row) => row.id === focusedId);
        setSelectedSource((prior) => focused?.scan.source || prior || data.latest.source || '');
        setCurrentId(
          (prior) =>
            focused?.id ||
            (data.scans.some((row) => row.id === prior) ? prior : (data.latest.scan?.id ?? ''))
        );
      })
      .catch((error) => {
        if (!canceled) setHistoryError(errorMessage(error));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [ownerId, dependentId, revision]);
  const selection = useMemo(
    () => selectCoherentScan(rows, preferences, selectedSource || undefined),
    [rows, preferences, selectedSource]
  );
  const visible = useMemo(
    () => rows.filter((row) => !selectedSource || row.scan.source === selectedSource),
    [rows, selectedSource]
  );
  const current = visible.find((row) => row.id === currentId) ?? selection.scan;
  const baseline = visible.find((row) => row.id === baselineId);
  const chartRows = useMemo(
    () =>
      current
        ? visible
            .filter(
              (row) =>
                scanDeviceKey(row) === scanDeviceKey(current) &&
                ['day', 'instant'].includes(row.scan.measured_at.precision) &&
                !row.scan.measured_at.approximate &&
                (row.id === current.id ||
                  scanMetricComparisonWarnings(row, current, chartMetric).length === 0)
            )
            .slice()
            .reverse()
            .map((row) => ({
              id: row.id,
              date: formatClinicalDate(row.scan.measured_at),
              value: row.measurements.find((m) => m.metric_key === chartMetric)?.value ?? null,
              source: row.scan.source,
              model: row.scan.model ?? row.scan.method,
            }))
        : [],
    [current, visible, chartMetric]
  );
  function invalidate() {
    setPreview(null);
    setOutcomes([]);
    setDraftError(null);
  }
  function updateMetric(index: number, patch: Partial<MetricDraft>) {
    invalidate();
    setMetrics((old) => old.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function addMetricGroup(keys: string[]) {
    invalidate();
    setMetrics((old) =>
      [
        ...old,
        ...keys
          .filter((key) => !old.some((row) => row.metric === key))
          .map((metric) => ({ metric, value: '', unit: defaultUnit(metric) })),
      ].slice(0, 50)
    );
  }
  function makePreview(event: React.FormEvent) {
    event.preventDefault();
    setDraftError(null);
    setOutcomes([]);
    try {
      let candidates: unknown[];
      if (mode === 'json') {
        if (new TextEncoder().encode(json).length > 131072)
          throw new Error(
            'Import preview must not exceed 128 KiB. Split this JSON into smaller batches.'
          );
        const parsed = JSON.parse(json);
        candidates = Array.isArray(parsed) ? parsed : [parsed];
        if (candidates.length < 1 || candidates.length > 25)
          throw new Error('Import between 1 and 25 scan objects at a time.');
      } else {
        const id = externalId || crypto.randomUUID();
        if (!externalId) setExternalId(id);
        const measured_at = {
          precision,
          value: precision === 'unknown' ? null : date,
          ...(dateText ? { original_text: dateText } : {}),
          ...(approximate ? { approximate: true } : {}),
          ...(precision === 'instant' && timezone.trim() ? { timezone: timezone.trim() } : {}),
        };
        candidates = [
          {
            external_id: id,
            source,
            manufacturer: manufacturer || undefined,
            model: model || undefined,
            method,
            measured_at,
            conditions: {
              workout_status: workout,
              fasting_status: fasting,
              notes: notes || undefined,
              ...(workoutAt.trim() || workoutTimezone.trim()
                ? {
                    workout_at: {
                      precision: 'instant',
                      value: workoutAt.trim(),
                      ...(workoutTimezone.trim() ? { timezone: workoutTimezone.trim() } : {}),
                    },
                  }
                : {}),
            },
            supplement_record_ids: supplementIds,
            provenance: {
              basis: 'source_reported',
              verification: 'unconfirmed',
              sources: sources
                .filter((row) => row.reference.trim() || row.document_id.trim() || row.page.trim())
                .map((row) => ({
                  reference: row.reference,
                  ...(row.document_id.trim() ? { document_id: row.document_id.trim() } : {}),
                  ...(row.page.trim()
                    ? { page: /^\d+$/.test(row.page.trim()) ? Number(row.page) : Number.NaN }
                    : {}),
                })),
            },
            vendor_results: parseVendorResults(vendor),
            measurements: metrics
              .filter((row) => row.value.trim() !== '')
              .map((row) => ({
                metric_key: row.metric,
                value: /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(row.value.trim())
                  ? Number(row.value)
                  : Number.NaN,
                unit: row.unit,
                raw_text: `${row.value} ${row.unit}`,
                ...(row.definition?.trim() ? { definition: row.definition.trim() } : {}),
              })),
          },
        ];
      }
      const parsed = candidates.map((candidate) => scanInputSchema.parse(candidate));
      parsed.forEach(normalizeScanMeasurements);
      if (new TextEncoder().encode(JSON.stringify(parsed)).length > 131072)
        throw new Error(
          'Import preview must not exceed 128 KiB. Split this JSON into smaller batches.'
        );
      setPreview(parsed);
    } catch (error) {
      setPreview(null);
      setDraftError(errorMessage(error));
    }
  }
  async function save() {
    if (!preview || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setOutcomes([]);
    let saved = 0;
    try {
      for (const scan of preview) {
        if (!mounted.current) break;
        try {
          const result = await apiFetch<{ result: 'created' | 'existing'; scan: BodyScan }>(
            '/api/scans',
            { method: 'POST', body: JSON.stringify({ ...scope, scan }) }
          );
          saved++;
          setOutcomes((old) => [...old, { id: scan.external_id, result: result.result }]);
        } catch (error) {
          setOutcomes((old) => [
            ...old,
            { id: scan.external_id, result: 'failed', message: errorMessage(error) },
          ]);
        }
      }
      if (saved) setRevision((value) => value + 1);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  function newScan() {
    invalidate();
    setExternalId('');
    setMetrics([{ metric: 'skeletal_muscle_mass', value: '', unit: 'kg' }]);
    setPrecision('unknown');
    setDate('');
    setDateText('');
    setTimezone('');
    setApproximate(false);
    setWorkout('unknown');
    setFasting('unknown');
    setNotes('');
    setWorkoutAt('');
    setWorkoutTimezone('');
    setSupplementIds([]);
    setSources([emptySourceDraft()]);
    setVendor(emptyVendorResults());
  }
  return (
    <main className="space-y-6" style={{ color: 'var(--color-text-primary)' }}>
      <header className="space-y-2">
        <Link href="/vitals" className="text-sm underline">
          ← Vitals &amp; Wearables
        </Link>
        <h1 className="text-2xl font-bold">Body composition scans</h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Keep each source report together. BIA values are estimates; muscle and water compartments
          overlap and must not be added together.
        </p>
      </header>
      {canWrite && (
        <section
          className="rounded-xl border p-4 sm:p-6 space-y-4"
          style={card}
          aria-labelledby="scan-entry-title"
        >
          <h2 id="scan-entry-title" className="font-semibold text-lg">
            Add a scan
          </h2>
          <div className="flex gap-2" role="group" aria-label="Scan input method">
            {(['manual', 'json'] as const).map((value) => (
              <button
                key={value}
                type="button"
                disabled={saving}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  invalidate();
                }}
                className="min-h-11 rounded-lg border px-4"
                style={
                  mode === value
                    ? { ...controlStyle, borderColor: 'var(--color-sage)' }
                    : controlStyle
                }
              >
                {value === 'manual' ? 'Manual entry' : 'JSON import'}
              </button>
            ))}
          </div>
          <form onSubmit={makePreview} className="space-y-4">
            <fieldset disabled={saving} className="space-y-4">
              {mode === 'manual' ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Source name
                      <input
                        required
                        value={source}
                        onChange={(e) => {
                          setSource(e.target.value);
                          invalidate();
                        }}
                        className={control}
                        style={controlStyle}
                        placeholder="e.g. InBody clinic"
                        maxLength={100}
                      />
                    </label>
                    <label className="text-sm">
                      Source scan / report ID
                      <input
                        value={externalId}
                        onChange={(e) => {
                          setExternalId(e.target.value);
                          invalidate();
                        }}
                        className={control}
                        style={controlStyle}
                        placeholder="Generated if blank"
                        maxLength={200}
                      />
                    </label>
                    <label className="text-sm">
                      Manufacturer
                      <input
                        value={manufacturer}
                        onChange={(e) => {
                          setManufacturer(e.target.value);
                          invalidate();
                        }}
                        className={control}
                        style={controlStyle}
                      />
                    </label>
                    <label className="text-sm">
                      Device model
                      <input
                        value={model}
                        onChange={(e) => {
                          setModel(e.target.value);
                          invalidate();
                        }}
                        className={control}
                        style={controlStyle}
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Measurement method
                      <select
                        value={method}
                        onChange={(e) => {
                          setMethod(e.target.value as ScanInput['method']);
                          invalidate();
                        }}
                        className={control}
                        style={controlStyle}
                      >
                        {['bia', 'dxa', 'tape', 'other', 'unknown'].map((value) => (
                          <option key={value} value={value}>
                            {value.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      Date precision
                      <select
                        value={precision}
                        onChange={(e) => {
                          setPrecision(e.target.value as ClinicalDate['precision']);
                          setDate('');
                          setTimezone('');
                          invalidate();
                        }}
                        className={control}
                        style={controlStyle}
                      >
                        {['unknown', 'year', 'month', 'day', 'instant'].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {precision !== 'unknown' && (
                    <label className="block text-sm">
                      Measurement date or exact time
                      <input
                        required
                        value={date}
                        onChange={(e) => {
                          setDate(e.target.value);
                          invalidate();
                        }}
                        type={
                          precision === 'day' ? 'date' : precision === 'month' ? 'month' : 'text'
                        }
                        placeholder={
                          precision === 'instant'
                            ? '2026-10-30T09:30:00-07:00'
                            : precision === 'year'
                              ? '2026'
                              : undefined
                        }
                        className={control}
                        style={controlStyle}
                      />
                      <span className="text-xs">
                        Exact times require the reported UTC offset. Partial dates stay partial.
                      </span>
                    </label>
                  )}
                  {precision === 'instant' && (
                    <label className="block text-sm">
                      Measurement timezone (optional)
                      <input
                        value={timezone}
                        onChange={(event) => {
                          setTimezone(event.target.value);
                          invalidate();
                        }}
                        className={control}
                        style={controlStyle}
                        maxLength={100}
                        placeholder="America/Phoenix"
                      />
                      <span className="text-xs">
                        Use the source timezone when known. The explicit timestamp offset remains
                        authoritative; no timezone is inferred from this browser.
                      </span>
                    </label>
                  )}
                  <label className="block text-sm">
                    Original date text, if useful
                    <input
                      value={dateText}
                      onChange={(e) => {
                        setDateText(e.target.value);
                        invalidate();
                      }}
                      className={control}
                      style={controlStyle}
                      placeholder="e.g. approximately October 2026"
                    />
                  </label>
                  <label className="flex items-center gap-2 min-h-11 text-sm">
                    <input
                      type="checkbox"
                      checked={approximate}
                      onChange={(e) => {
                        setApproximate(e.target.checked);
                        invalidate();
                      }}
                    />
                    Date is approximate
                  </label>
                  <fieldset className="space-y-3">
                    <legend className="font-medium">Reported measurements</legend>
                    <p className="text-xs">
                      Blank rows are not imported. Source units and entered precision are retained;
                      water volumes in liters are not converted into mass. Regional lean mass is not
                      skeletal muscle mass. Compartments overlap and must not be summed.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="min-h-11 rounded-lg border px-3 text-sm"
                        disabled={metrics.length > 40}
                        onClick={() =>
                          addMetricGroup(
                            ['left_arm', 'right_arm', 'left_leg', 'right_leg', 'trunk'].flatMap(
                              (region) => [`lean_mass_${region}`, `fat_mass_${region}`]
                            )
                          )
                        }
                      >
                        Add five-region lean and fat rows
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-lg border px-3 text-sm"
                        disabled={metrics.length > 45}
                        onClick={() =>
                          addMetricGroup(
                            ['left_arm', 'right_arm', 'left_leg', 'right_leg', 'trunk'].map(
                              (region) => `ecw_ratio_${region}`
                            )
                          )
                        }
                      >
                        Add regional ECW ratio rows
                      </button>
                    </div>
                    {metrics.map((row, index) => (
                      <div
                        key={index}
                        className="rounded-lg border p-3 space-y-2"
                        style={{ borderColor: 'var(--border-card)' }}
                      >
                        <label className="block text-sm">
                          Metric {index + 1}
                          <select
                            value={row.metric}
                            onChange={(e) =>
                              updateMetric(index, {
                                metric: e.target.value,
                                unit: defaultUnit(e.target.value),
                                definition: '',
                              })
                            }
                            className={control}
                            style={controlStyle}
                          >
                            {scanMetrics.map((metric) => (
                              <option key={metric.key} value={metric.key}>
                                {metric.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-sm">
                            Value
                            <input
                              inputMode="decimal"
                              value={row.value}
                              onChange={(e) => updateMetric(index, { value: e.target.value })}
                              className={control}
                              style={controlStyle}
                              placeholder="Not reported"
                            />
                          </label>
                          <label className="text-sm">
                            Source unit
                            <input
                              required
                              value={row.unit}
                              list={`scan-units-${index}`}
                              onChange={(e) => updateMetric(index, { unit: e.target.value })}
                              className={control}
                              style={controlStyle}
                            />
                            <datalist id={`scan-units-${index}`}>
                              {scanMetricUnits(row.metric).map((unit) => (
                                <option key={unit} value={unit} />
                              ))}
                            </datalist>
                          </label>
                        </div>
                        <label className="block text-sm">
                          Source definition / protocol
                          <input
                            aria-label={`Metric ${index + 1}: Source definition / protocol`}
                            value={row.definition ?? ''}
                            onChange={(event) =>
                              updateMetric(index, { definition: event.target.value })
                            }
                            maxLength={4000}
                            className={control}
                            style={controlStyle}
                            placeholder={
                              isSourceDefinedScanMetric(row.metric)
                                ? 'e.g. region, frequency, and numerator / denominator from the report'
                                : 'Optional exact definition from the report'
                            }
                          />
                        </label>
                        {isSourceDefinedScanMetric(row.metric) && (
                          <p className="text-xs">
                            This metric stays source-defined. A matching definition/protocol,
                            device, method and known collection conditions are required for
                            comparisons. SMI is not calculated from regional lean mass.
                          </p>
                        )}
                        {metrics.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setMetrics((old) => old.filter((_, i) => i !== index));
                              invalidate();
                            }}
                            className="text-sm underline min-h-11"
                          >
                            Remove row
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={metrics.length >= 50}
                      onClick={() => {
                        setMetrics((old) => [...old, { metric: 'weight', value: '', unit: 'kg' }]);
                        invalidate();
                      }}
                      className="min-h-11 rounded-lg border px-4"
                      style={controlStyle}
                    >
                      Add measurement
                    </button>
                  </fieldset>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Workout context
                      <select
                        value={workout}
                        onChange={(e) => {
                          setWorkout(e.target.value as typeof workout);
                          invalidate();
                        }}
                        className={control}
                        style={controlStyle}
                      >
                        <option value="unknown">Unknown</option>
                        <option value="pre_workout">Pre-workout</option>
                        <option value="post_workout">Post-workout</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      Fasting context
                      <select
                        value={fasting}
                        onChange={(e) => {
                          setFasting(e.target.value as typeof fasting);
                          invalidate();
                        }}
                        className={control}
                        style={controlStyle}
                      >
                        <option value="unknown">Unknown</option>
                        <option value="fasted">Fasted</option>
                        <option value="fed">Fed</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      Workout exact timestamp (optional)
                      <input
                        value={workoutAt}
                        onChange={(event) => {
                          setWorkoutAt(event.target.value);
                          invalidate();
                        }}
                        required={!!workoutTimezone.trim()}
                        placeholder="2026-10-30T08:00:00-07:00"
                        className={control}
                        style={controlStyle}
                      />
                      <span className="text-xs">
                        Requires the reported UTC offset. Leave unknown times blank.
                      </span>
                    </label>
                    <label className="text-sm">
                      Workout timezone (optional)
                      <input
                        value={workoutTimezone}
                        onChange={(event) => {
                          setWorkoutTimezone(event.target.value);
                          invalidate();
                        }}
                        maxLength={100}
                        placeholder="America/Phoenix"
                        className={control}
                        style={controlStyle}
                      />
                    </label>
                  </div>
                  <label className="block text-sm">
                    Known collection-condition notes
                    <textarea
                      value={notes}
                      onChange={(e) => {
                        setNotes(e.target.value);
                        invalidate();
                      }}
                      className={control}
                      style={controlStyle}
                      rows={2}
                    />
                  </label>
                  <SupplementLinks
                    ownerId={ownerId}
                    dependentId={dependentId}
                    selected={supplementIds}
                    onChange={(ids) => {
                      setSupplementIds(ids);
                      invalidate();
                    }}
                  />
                  <SourceReferences
                    sources={sources}
                    onChange={(rows) => {
                      setSources(rows);
                      invalidate();
                    }}
                  />
                  <VendorResultsFields
                    draft={vendor}
                    onChange={(draft) => {
                      setVendor(draft);
                      invalidate();
                    }}
                  />
                </>
              ) : (
                <>
                  <label className="block text-sm">
                    Scan JSON
                    <textarea
                      value={json}
                      onChange={(e) => {
                        setJson(e.target.value);
                        invalidate();
                      }}
                      className={control + ' font-mono text-xs'}
                      style={controlStyle}
                      rows={12}
                      maxLength={131072}
                      placeholder={
                        '{"external_id":"report-1","source":"Fictional BIA","method":"bia","measured_at":{"precision":"day","value":"2026-10-30"},"provenance":{"basis":"source_reported","sources":[{"reference":"Report 1"}]},"measurements":[{"metric_key":"skeletal_muscle_mass","value":30.1234,"unit":"kg"}]}'
                      }
                    />
                  </label>
                  <p className="text-xs">
                    Paste one scan object or an array of up to 25 scans, at most 128 KiB. Vendor
                    PDF/CSV parsing is not included. Unknown fields are rejected so unsupported
                    content cannot disappear silently.
                  </p>
                </>
              )}
              {draftError && (
                <p
                  role="alert"
                  className="text-sm break-words"
                  style={{ color: 'var(--color-terracotta)' }}
                >
                  {draftError}
                </p>
              )}
              <button
                type="submit"
                disabled={saving}
                className="min-h-11 rounded-lg px-4 font-medium"
                style={{ backgroundColor: 'var(--color-sage)', color: 'var(--bg-primary)' }}
              >
                Preview scan{mode === 'json' ? ' import' : ''}
              </button>
            </fieldset>
          </form>
          {preview && (
            <section
              aria-label="Scan import preview"
              className="rounded-lg border p-4 space-y-3"
              style={card}
            >
              <h3 className="font-semibold">
                Review {preview.length} scan{preview.length === 1 ? '' : 's'}
              </h3>
              {preview.map((scan) => (
                <div
                  key={scan.external_id + scan.source}
                  className="text-sm border-b pb-3 break-words"
                  style={{ borderColor: 'var(--border-card)' }}
                >
                  <p className="font-medium">
                    {scan.external_id} · {scan.source} · {scan.model || scan.method}
                  </p>
                  <p>
                    {formatClinicalDate(scan.measured_at)} · {scan.measurements.length} reported
                    values
                  </p>
                  <p>
                    {scan.measurements
                      .map(
                        (m) =>
                          `${getScanMetric(m.metric_key)?.label}: ${m.raw_text ?? `${m.value} ${m.unit}`}${m.definition ? ` (${m.definition})` : ''}`
                      )
                      .join('; ')}
                  </p>
                  <p className="text-xs">
                    Workout time: {formatClinicalDate(scan.conditions?.workout_at)} · Linked
                    supplements: {scan.supplement_record_ids?.length ?? 0}
                  </p>
                  <ul className="text-xs">
                    {scan.provenance.sources.map((reference, index) => (
                      <li key={index}>
                        {reference.reference}
                        {reference.document_id ? ` · document ${reference.document_id}` : ''}
                        {reference.page ? ` · page ${reference.page}` : ''}
                      </li>
                    ))}
                  </ul>
                  <ScanAdditionalEvidence
                    scan={{
                      id: 'preview',
                      user_id: '',
                      dependent_id: null,
                      scan,
                      measurements: normalizeScanMeasurements(scan),
                      revision: '',
                      received_at: '',
                    }}
                  />
                </div>
              ))}
              <p className="text-xs">
                Confirming saves each complete scan for the selected person. Replaying the same
                source scan ID is safe; changed content requires a distinct identity and is never
                silently overwritten.
              </p>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="min-h-11 rounded-lg px-4 font-medium"
                style={{ backgroundColor: 'var(--color-sage)', color: 'var(--bg-primary)' }}
              >
                {saving ? 'Saving scans…' : 'Confirm and save scans'}
              </button>
              <button
                type="button"
                onClick={newScan}
                disabled={saving}
                className="min-h-11 px-4 underline text-sm"
              >
                Start another scan
              </button>
              {outcomes.length > 0 && (
                <ul aria-live="polite" className="space-y-1 text-sm">
                  {outcomes.map((outcome, index) => (
                    <li key={index}>
                      {outcome.id}:{' '}
                      {outcome.result === 'existing'
                        ? 'Already saved'
                        : outcome.result === 'created'
                          ? 'Created'
                          : `Failed — ${outcome.message}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </section>
      )}
      <section
        className="rounded-xl border p-4 sm:p-6 space-y-4"
        style={card}
        aria-labelledby="scan-history-title"
      >
        <h2 id="scan-history-title" className="font-semibold text-lg">
          Scan history and comparison
        </h2>
        {loading ? (
          <p role="status">Loading scans…</p>
        ) : historyError ? (
          <p role="alert">{historyError}</p>
        ) : (
          <>
            {truncated && (
              <p className="text-sm">
                Showing at most 100 sessions. API history supports an explicit source filter; this
                is not the complete account archive.
              </p>
            )}
            <label className="block text-sm">
              Source for comparison
              <select
                value={selectedSource}
                onChange={(e) => {
                  setSelectedSource(e.target.value);
                  setCurrentId('');
                  setBaselineId('');
                }}
                className={control}
                style={controlStyle}
              >
                <option value="">Choose a source</option>
                {[
                  ...new Set([
                    ...rows.map((row) => row.scan.source),
                    ...(selection.source ? [selection.source] : []),
                  ]),
                ]
                  .sort()
                  .map((value) => (
                    <option key={value}>{value}</option>
                  ))}
              </select>
            </label>
            {selection.warnings.map((warning) => (
              <p key={warning} className="text-sm" role="status">
                {warning}
              </p>
            ))}
            {selectedSource && (
              <>
                <label className="block text-sm">
                  Session
                  <select
                    value={current?.id ?? ''}
                    onChange={(e) => setCurrentId(e.target.value)}
                    className={control}
                    style={controlStyle}
                  >
                    <option value="">Choose a session</option>
                    {visible.map((row) => (
                      <option key={row.id} value={row.id}>
                        {sessionLabel(row)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Compare with baseline
                  <select
                    value={baselineId}
                    onChange={(e) => setBaselineId(e.target.value)}
                    className={control}
                    style={controlStyle}
                  >
                    <option value="">No baseline</option>
                    {visible
                      .filter((row) => row.id !== current?.id)
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {sessionLabel(row)}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            {current && selectedSource && <ScanDetails scan={current} baseline={baseline} />}
            {baseline &&
              current &&
              scanComparisonWarnings(current, baseline).map((warning) => (
                <p key={warning} className="text-sm">
                  {warning}
                </p>
              ))}
            {current && selectedSource && (
              <section className="space-y-3">
                <label className="block text-sm">
                  Observation plot
                  <select
                    value={chartMetric}
                    onChange={(e) => setChartMetric(e.target.value)}
                    className={control}
                    style={controlStyle}
                  >
                    {scanMetrics.map((metric) => (
                      <option key={metric.key} value={metric.key}>
                        {metric.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs">
                  Only matching source, device, method, units, definitions and known collection
                  conditions share a plot. The selected observation can appear alone when
                  comparisons are uncertain. Dots do not connect sessions; partial or unknown dates
                  stay in history. Vendor scores and derived ratios are not plotted as reported
                  measurements.
                </p>
                {chartRows.every((row) => row.value === null) ? (
                  <p className="text-sm">
                    This metric is not reported for the selected source and device. Missing readings
                    remain missing.
                  </p>
                ) : (
                  <div
                    className="h-56 min-w-0"
                    role="img"
                    aria-label={`${getScanMetric(chartMetric)?.label} observations for ${current.scan.source} ${current.scan.model ?? current.scan.method}`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartRows}>
                        <XAxis dataKey="date" hide />
                        <YAxis
                          width={60}
                          domain={['auto', 'auto']}
                          tickFormatter={(value: number) => formatScanComparisonValue(value)}
                        />
                        <Tooltip
                          formatter={(value) =>
                            typeof value === 'number' ? formatScanComparisonValue(value) : value
                          }
                        />
                        <Line
                          dataKey="value"
                          stroke="none"
                          dot={{ fill: 'var(--color-sage)', r: 4 }}
                          isAnimationActive={false}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
            )}
            {rows.length === 0 ? (
              <p>
                No scans for this person yet. Existing daily scale/tape readings remain in{' '}
                <Link href="/vitals" className="underline">
                  Vitals
                </Link>
                .
              </p>
            ) : (
              <ul className="space-y-3" aria-label="Saved scans">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    id={`scan-${row.id}`}
                    className="rounded-lg border p-3 break-words"
                    style={{ borderColor: 'var(--border-card)' }}
                  >
                    <p className="font-medium text-sm">{sessionLabel(row)}</p>
                    <p className="text-xs">
                      {row.scan.manufacturer ?? 'Manufacturer unknown'} ·{' '}
                      {row.scan.model ?? 'Model unknown'} · {row.scan.method.toUpperCase()} ·{' '}
                      {row.scan.method === 'bia' ? 'Estimates' : 'Source-reported measurements'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSource(row.scan.source);
                        setCurrentId(row.id);
                      }}
                      className="min-h-11 underline text-sm"
                    >
                      Open this scan
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
function ScanDetails({ scan, baseline }: { scan: BodyScan; baseline?: BodyScan }) {
  return (
    <article
      className="space-y-3 rounded-lg border p-3"
      style={{ borderColor: 'var(--border-card)' }}
      aria-label="Selected scan"
    >
      <h3 className="font-medium break-words">{sessionLabel(scan)}</h3>
      <p className="text-xs">
        {scan.scan.method === 'bia'
          ? 'BIA estimates; not measured tissue quantities.'
          : 'Source-reported measurements.'}{' '}
        Muscle and water compartments overlap. Generic muscle percentage is not skeletal muscle;
        visceral-fat level is source/device-specific, not cm².
      </p>
      <p className="text-sm">
        Workout: {scan.scan.conditions?.workout_status ?? 'unknown'} · Fasting:{' '}
        {scan.scan.conditions?.fasting_status ?? 'unknown'}
      </p>
      <p className="text-sm">
        Workout time: {formatClinicalDate(scan.scan.conditions?.workout_at)}
      </p>
      {scan.scan.supplement_record_ids?.length ? (
        <p className="text-sm break-words">
          Linked supplement record IDs: {scan.scan.supplement_record_ids.join(', ')}. Links do not
          establish actual use or dose.
        </p>
      ) : null}
      {scan.scan.conditions?.notes && (
        <p className="text-sm break-words">{scan.scan.conditions.notes}</p>
      )}
      <dl className="space-y-3">
        {scan.measurements.map((m) => {
          const delta = baseline ? scanMetricDelta(scan, baseline, m.metric_key) : null;
          return (
            <div
              key={m.metric_key}
              className="border-b pb-2"
              style={{ borderColor: 'var(--border-card)' }}
            >
              <dt className="text-sm font-medium">
                {scanMeasurementLabel(m.metric_key, m.estimated)}
              </dt>
              <dd className="text-sm break-words">
                Source: {m.raw_text ?? `${m.source_value} ${m.source_unit}`}
                {m.definition && (
                  <span className="block text-xs">Source definition: {m.definition}</span>
                )}
                {!m.definition && isSourceDefinedScanMetric(m.metric_key) && (
                  <span className="block text-xs">
                    Source definition / protocol unknown; comparisons withheld.
                  </span>
                )}
                <span className="block text-xs">
                  Comparison units: {formatScanComparisonValue(m.value)} {m.unit ?? ''}
                </span>
                {baseline && (
                  <span className="block text-xs">
                    Change from selected baseline:{' '}
                    {delta === null
                      ? 'Unavailable / not comparable'
                      : `${formatScanComparisonValue(delta, true)} ${m.unit ?? ''}`}
                  </span>
                )}
                {baseline &&
                  scanMetricComparisonWarnings(scan, baseline, m.metric_key)
                    .filter((warning) => !scanComparisonWarnings(scan, baseline).includes(warning))
                    .map((warning) => (
                      <span key={warning} className="block text-xs">
                        {warning}
                      </span>
                    ))}
              </dd>
            </div>
          );
        })}
      </dl>
      <ScanAdditionalEvidence scan={scan} />
      <details>
        <summary className="min-h-11 cursor-pointer text-sm">
          Source references and exact saved payload
        </summary>
        <ul className="text-sm break-words">
          {scan.scan.provenance.sources.map((reference, index) => (
            <li key={index}>
              {reference.reference}
              {reference.page ? ` · page ${reference.page}` : ''}
              {reference.document_id ? ` · document ${reference.document_id}` : ''}
            </li>
          ))}
        </ul>
        <p className="text-xs">
          Receipt: {scan.received_at}. This is not the measurement time. Source references do not
          grant access to protected originals.
        </p>
        <pre
          className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg p-3 text-xs"
          style={controlStyle}
        >
          {JSON.stringify(scan.scan, null, 2)}
        </pre>
      </details>
    </article>
  );
}

function ScanAdditionalEvidence({ scan }: { scan: BodyScan }) {
  const rows = scanEvidenceRows(scan);
  return (
    <>
      {(['derived', 'vendor'] as const).map((basis) => {
        const evidence = rows.filter((row) => row.basis === basis);
        if (!evidence.length) return null;
        return (
          <section
            key={basis}
            aria-label={basis === 'derived' ? 'Derived from this scan' : 'Source vendor outputs'}
            className="space-y-2 rounded-lg border p-3"
            style={{ borderColor: 'var(--border-card)' }}
          >
            <h4 className="font-medium">
              {basis === 'derived' ? 'Derived from this scan' : 'Source vendor outputs'}
            </h4>
            <p className="text-xs">
              {basis === 'derived'
                ? 'Calculated only from mass values in this report. These are not additional reported measurements and do not replace a source-reported ratio.'
                : 'Source-specific scores, estimates and reference bands. Recommendations are preserved as printed and do not change adopted goals or targets.'}
            </p>
            <dl className="space-y-3">
              {evidence.map((row) => (
                <div key={row.key} className="text-sm break-words">
                  <dt className="font-medium">{row.label}</dt>
                  <dd>
                    {row.basis === 'derived'
                      ? formatScanComparisonValue(Number(row.value))
                      : row.value}
                    {row.unit ? ` ${row.unit}` : ''}
                    {row.definition && (
                      <span className="block text-xs">Definition: {row.definition}</span>
                    )}
                    {row.reference && (
                      <span className="block text-xs">Source reference: {row.reference}</span>
                    )}
                    {row.formula && (
                      <span className="block text-xs">
                        Formula: {row.formula}. Inputs: {row.input_metric_keys?.join(', ')}.
                      </span>
                    )}
                    <span className="block text-xs">Source: {row.source}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </>
  );
}
