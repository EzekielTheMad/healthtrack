'use client';
import { useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FidelityRecord } from '@/lib/fidelity/contracts';
import { encounterObservationSeries } from '@/lib/fidelity/web-clinical-presentation';
export default function EncounterObservationTrends({ records }: { records: FidelityRecord[] }) {
  const series = encounterObservationSeries(records);
  const [selectedId, setSelectedId] = useState('');
  const selected = series.find((s) => s.id === selectedId) ?? series[0];
  if (!selected) return null;
  return (
    <section className="space-y-3 min-w-0" aria-label="Encounter observation trends">
      <h3 className="font-semibold">Recorded encounter observations</h3>
      <label className="block text-sm space-y-1">
        <span>Comparable observation series</span>
        <select
          className="w-full min-w-0 rounded-lg border px-3 py-2"
          style={{
            background: 'var(--bg-primary)',
            color: 'var(--color-text-primary)',
            borderColor: 'var(--border-card)',
          }}
          value={selected.id}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {series.map((s, i) => (
            <option value={s.id} key={s.id}>
              {i + 1}. {s.label} ({s.unit}) · {s.context.replaceAll('_', ' ')} · {s.statistic}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs break-words" style={{ color: 'var(--color-text-muted)' }}>
        Source: {selected.source} · Context: {selected.context.replaceAll('_', ' ')} · Statistic:{' '}
        {selected.statistic} · Definition: {selected.definition}
      </p>
      <div className="h-48 min-w-0" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={selected.points} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis width={48} tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
            <Tooltip />
            <Line
              dataKey="value"
              name={selected.label}
              unit={' ' + selected.unit}
              stroke="var(--color-terracotta)"
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="text-sm cursor-pointer">
          View every plotted observation ({selected.points.length})
        </summary>
        <ul className="space-y-1 mt-2 text-sm">
          {selected.points.map((point) => (
            <li key={point.id} className="break-words">
              <a className="underline" href={'#record-' + point.record_id}>
                {point.date} · {point.value} {selected.unit} · {point.observation_key}
              </a>
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Only exact, non-conflicting dates with a known source, context and statistic are plotted.
        Repeated same-day values stay separate. Unknown/approximate dates and report windows remain
        in history.
      </p>
    </section>
  );
}
