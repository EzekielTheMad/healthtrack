'use client';

import { vendorScanResultsSchema } from '@/lib/fidelity/web-scan-contracts';

type DraftRow = Record<string, string>;
export type VendorResultsDraft = {
  scores: DraftRow[];
  bodyAge: DraftRow | null;
  referenceBands: DraftRow[];
  recommendations: DraftRow[];
};
export const emptyVendorResults = (): VendorResultsDraft => ({
  scores: [],
  bodyAge: null,
  referenceBands: [],
  recommendations: [],
});
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
function number(value: string | undefined) {
  if (!value?.trim()) return undefined;
  if (!numberPattern.test(value.trim()) || !Number.isFinite(Number(value)))
    throw new Error(
      'Vendor numeric fields require a finite number. Leave unreported values blank.'
    );
  return Number(value);
}
function value(value: string | undefined) {
  const text = value?.trim() ?? '';
  return numberPattern.test(text) ? number(text) : text;
}
function reference(row: DraftRow) {
  if (![row.low, row.high, row.referenceUnit, row.referenceText].some((field) => field?.trim()))
    return undefined;
  return {
    low: number(row.low),
    high: number(row.high),
    unit: row.referenceUnit?.trim() || undefined,
    text: row.referenceText?.trim() || undefined,
  };
}
/** No blanket Number('') conversion: blanks remain unreported, while genuine zero survives. */
export function parseVendorResults(draft: VendorResultsDraft) {
  if (
    !draft.scores.length &&
    !draft.bodyAge &&
    !draft.referenceBands.length &&
    !draft.recommendations.length
  )
    return undefined;
  return vendorScanResultsSchema.parse({
    scores: draft.scores.map((row) => ({
      key: row.key,
      name: row.name,
      value: value(row.value),
      unit: row.unit?.trim() || undefined,
      definition: row.definition?.trim() || undefined,
      reference: reference(row),
    })),
    ...(draft.bodyAge
      ? {
          body_age: {
            value: value(draft.bodyAge.value),
            unit: draft.bodyAge.unit,
            definition: draft.bodyAge.definition?.trim() || undefined,
            reference: reference(draft.bodyAge),
          },
        }
      : {}),
    reference_bands: draft.referenceBands.map((row) => ({
      metric_key: row.metric_key?.trim() || undefined,
      label: row.label,
      reference: reference(row) ?? {},
    })),
    recommendations: draft.recommendations.map((row) => ({
      name: row.name,
      text: row.text,
      value: number(row.value),
      unit: row.unit?.trim() || undefined,
    })),
  });
}

const control = 'min-h-11 w-full rounded-lg border px-3 py-2 text-sm';
const style = {
  backgroundColor: 'var(--bg-primary)',
  borderColor: 'var(--border-card)',
  color: 'var(--color-text-primary)',
};
const referenceFields = [
  ['low', 'Reference lower bound'],
  ['high', 'Reference upper bound'],
  ['referenceUnit', 'Reference unit'],
  ['referenceText', 'Reference description'],
] as const;
function Fields({
  row,
  fields,
  onChange,
  prefix,
}: {
  row: DraftRow;
  fields: readonly (readonly [string, string])[];
  onChange: (row: DraftRow) => void;
  prefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map(([key, label]) => (
        <label className="text-sm" key={key}>
          {label}
          <input
            aria-label={`${prefix}: ${label}`}
            className={control}
            style={style}
            value={row[key] ?? ''}
            maxLength={
              key === 'definition' || key === 'text' || key === 'referenceText' ? 4000 : 200
            }
            onChange={(event) => onChange({ ...row, [key]: event.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

export default function VendorResultsFields({
  draft,
  onChange,
}: {
  draft: VendorResultsDraft;
  onChange: (draft: VendorResultsDraft) => void;
}) {
  const sections = [
    {
      key: 'scores',
      label: 'Source scores',
      singular: 'Source score',
      fields: [
        ['key', 'Score identifier'],
        ['name', 'Score name'],
        ['value', 'Reported value or text'],
        ['unit', 'Source unit'],
        ['definition', 'Source definition'],
        ...referenceFields,
      ],
      limit: 50,
    },
    {
      key: 'referenceBands',
      label: 'Source reference bands',
      singular: 'Reference band',
      fields: [
        ['label', 'Reference label'],
        ['metric_key', 'Metric key, if known'],
        ...referenceFields,
      ],
      limit: 100,
    },
    {
      key: 'recommendations',
      label: 'Source recommendations',
      singular: 'Recommendation',
      fields: [
        ['name', 'Recommendation name'],
        ['text', 'Recommendation text'],
        ['value', 'Optional numeric value'],
        ['unit', 'Source unit'],
      ],
      limit: 50,
    },
  ] as const;
  return (
    <details
      className="rounded-lg border p-3 space-y-4"
      style={{ borderColor: 'var(--border-card)' }}
    >
      <summary className="min-h-11 cursor-pointer font-medium">
        Vendor scores, body age, references and recommendations
      </summary>
      <p className="text-xs">
        Record what this source printed, including its units and definitions. These outputs stay
        bound to the source report. Recommendations do not change your goals or nutrition targets.
        Leave unreported numbers blank.
      </p>
      <fieldset className="space-y-3">
        <legend className="font-medium">Source body age</legend>
        {draft.bodyAge ? (
          <>
            <Fields
              prefix="Body age"
              row={draft.bodyAge}
              fields={[
                ['value', 'Reported value or text'],
                ['unit', 'Source unit'],
                ['definition', 'Source definition'],
                ...referenceFields,
              ]}
              onChange={(row) => onChange({ ...draft, bodyAge: row })}
            />
            <button
              type="button"
              className="min-h-11 text-sm underline"
              onClick={() => onChange({ ...draft, bodyAge: null })}
            >
              Remove body age
            </button>
          </>
        ) : (
          <button
            type="button"
            className="min-h-11 border rounded-lg px-3 text-sm"
            onClick={() => onChange({ ...draft, bodyAge: { value: '', unit: 'years' } })}
          >
            Add body age
          </button>
        )}
      </fieldset>
      {sections.map((section) => (
        <fieldset key={section.key} className="space-y-3">
          <legend className="font-medium">{section.label}</legend>
          {draft[section.key].map((row, index) => (
            <div
              key={index}
              className="border rounded-lg p-3 space-y-2"
              style={{ borderColor: 'var(--border-card)' }}
            >
              <h4 className="text-sm font-medium">
                {section.singular} {index + 1}
              </h4>
              <Fields
                prefix={`${section.singular} ${index + 1}`}
                row={row}
                fields={section.fields}
                onChange={(changed) =>
                  onChange({
                    ...draft,
                    [section.key]: draft[section.key].map((prior, i) =>
                      i === index ? changed : prior
                    ),
                  })
                }
              />
              <button
                type="button"
                className="min-h-11 text-sm underline"
                onClick={() =>
                  onChange({
                    ...draft,
                    [section.key]: draft[section.key].filter((_, i) => i !== index),
                  })
                }
              >
                Remove {section.singular.toLowerCase()} {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={draft[section.key].length >= section.limit}
            className="min-h-11 border rounded-lg px-3 text-sm"
            onClick={() => onChange({ ...draft, [section.key]: [...draft[section.key], {}] })}
          >
            Add {section.singular.toLowerCase()}
          </button>
        </fieldset>
      ))}
    </details>
  );
}
