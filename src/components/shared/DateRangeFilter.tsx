'use client';

import React, { useState, useCallback, useMemo } from 'react';

interface DateRange {
  from: Date;
  to: Date;
}

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

type Preset = '7D' | '1M' | '3M' | '6M' | '1Y' | 'All';

const presets: Preset[] = ['7D', '1M', '3M', '6M', '1Y', 'All'];

function getPresetRange(preset: Preset): DateRange {
  const to = new Date();
  const from = new Date();

  switch (preset) {
    case '7D':
      from.setDate(to.getDate() - 7);
      break;
    case '1M':
      from.setMonth(to.getMonth() - 1);
      break;
    case '3M':
      from.setMonth(to.getMonth() - 3);
      break;
    case '6M':
      from.setMonth(to.getMonth() - 6);
      break;
    case '1Y':
      from.setFullYear(to.getFullYear() - 1);
      break;
    case 'All':
      from.setFullYear(2000, 0, 1);
      break;
  }

  return { from, to };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function toInputValue(date: Date): string {
  return date.toISOString().split('T')[0];
}

function detectActivePreset(value: DateRange): Preset | null {
  const now = new Date();
  const diffMs = now.getTime() - value.from.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 8 && diffDays >= 6) return '7D';
  if (diffDays >= 28 && diffDays <= 32) return '1M';
  if (diffDays >= 88 && diffDays <= 93) return '3M';
  if (diffDays >= 178 && diffDays <= 185) return '6M';
  if (diffDays >= 363 && diffDays <= 367) return '1Y';
  if (value.from.getFullYear() <= 2000) return 'All';
  return null;
}

export default function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [showCustom, setShowCustom] = useState(false);
  const activePreset = useMemo(() => detectActivePreset(value), [value]);

  const handlePreset = useCallback(
    (preset: Preset) => {
      setShowCustom(false);
      onChange(getPresetRange(preset));
    },
    [onChange],
  );

  const handleCustomFrom = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const date = new Date(e.target.value);
      if (!isNaN(date.getTime())) {
        onChange({ from: date, to: value.to });
      }
    },
    [onChange, value.to],
  );

  const handleCustomTo = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const date = new Date(e.target.value);
      if (!isNaN(date.getTime())) {
        onChange({ from: value.from, to: date });
      }
    },
    [onChange, value.from],
  );

  return (
    <div
      className="sticky top-0 z-10 px-4 py-3 rounded-xl"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)', borderWidth: 1 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((preset) => {
          const isActive = !showCustom && activePreset === preset;
          return (
            <button
              key={preset}
              onClick={() => handlePreset(preset)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: isActive ? 'rgba(74,222,128,0.15)' : 'transparent',
                color: isActive ? 'var(--color-sage)' : 'var(--color-text-muted)',
                border: isActive ? '1px solid #4ADE80' : '1px solid #1E2642',
              }}
            >
              {preset}
            </button>
          );
        })}

        <button
          onClick={() => setShowCustom((prev) => !prev)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          style={{
            backgroundColor: showCustom ? 'rgba(74,222,128,0.15)' : 'transparent',
            color: showCustom ? 'var(--color-sage)' : 'var(--color-text-muted)',
            border: showCustom ? '1px solid #4ADE80' : '1px solid #1E2642',
          }}
        >
          Custom
        </button>
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            From
            <input
              type="date"
              value={toInputValue(value.from)}
              onChange={handleCustomFrom}
              className="px-2 py-1 rounded-lg text-xs font-mono"
              style={{
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--border-card)',
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            To
            <input
              type="date"
              value={toInputValue(value.to)}
              onChange={handleCustomTo}
              className="px-2 py-1 rounded-lg text-xs font-mono"
              style={{
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--border-card)',
              }}
            />
          </label>
        </div>
      )}

      <p className="mt-2 text-[11px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
        {formatDate(value.from)} &mdash; {formatDate(value.to)}
      </p>
    </div>
  );
}
