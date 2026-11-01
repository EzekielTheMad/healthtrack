'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { apiFetch } from '@/lib/api/client';
import {
  intakeSchema,
  type ClinicalFact,
  type ClinicalIntake,
  type FidelityRecord,
} from '@/lib/fidelity/contracts';
import type { ClinicalReview } from '@/lib/fidelity/clinical';
import ClinicalFactForm from './ClinicalFactForm';
import ClinicalFactDetails, { clinicalFactTitle } from './ClinicalFactDetails';
import TypedDocumentEvidence from './TypedDocumentEvidence';
const fieldStyle = {
  background: 'var(--bg-primary)',
  color: 'var(--color-text-primary)',
  borderColor: 'var(--border-card)',
};
const cls = 'w-full rounded-lg border px-3 py-2 min-w-0';
type Item = ClinicalIntake['items'][number];
const inputs = (review: ClinicalReview): Item[] =>
  review.items.map(({ item_key, action, fact, target_id, expected_revision, reason }) => ({
    item_key,
    action,
    fact,
    ...(target_id ? { target_id } : {}),
    ...(expected_revision ? { expected_revision } : {}),
    ...(reason ? { reason } : {}),
  }));
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl border p-4 sm:p-6 space-y-4"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      {children}
    </section>
  );
}
export default function ClinicalIntakeWorkspace() {
  const profile = useActiveProfile();
  const params = useSearchParams();
  return (
    <Workspace
      key={`${profile.delegateOwnerId ?? 'own'}:${profile.dependentId ?? 'self'}:${params.get('record_id') ?? ''}:${params.get('batch_id') ?? ''}:${params.get('document_id') ?? ''}`}
    />
  );
}
function Workspace() {
  const { dependentId, dependentName, delegateOwnerId } = useActiveProfile();
  const params = useSearchParams();
  const [records, setRecords] = useState<FidelityRecord[]>([]);
  const [batches, setBatches] = useState<ClinicalReview[]>([]);
  const [preview, setPreview] = useState<ClinicalReview | null>(null);
  const [draft, setDraft] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<'manual' | 'json'>('manual');
  const [json, setJson] = useState('');
  const [selectedOverride, setSelected] = useState<FidelityRecord | null | undefined>(undefined);
  const selected =
    selectedOverride === undefined
      ? (records.find((record) => record.id === params.get('record_id')) ?? null)
      : selectedOverride;
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [seedFact, setSeedFact] = useState<ClinicalFact | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [correctionReason, setCorrectionReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const alive = useRef(true);
  const manualIdentity = useRef<{ payload: string; id: string } | null>(null);
  const subject = dependentName ?? (dependentId ? 'Selected dependent' : 'Your own record');
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (delegateOwnerId) q.set('owner_id', delegateOwnerId);
    else if (dependentId) q.set('dependent_id', dependentId);
    q.set('limit', '1000');
    return q.toString();
  }, [dependentId, delegateOwnerId]);
  async function refresh() {
    const [result, saved] = await Promise.all([
      apiFetch<{ records: FidelityRecord[] }>(`/api/clinical-records?${query}`),
      delegateOwnerId
        ? Promise.resolve([])
        : apiFetch<ClinicalReview[]>(
            `/api/clinical-intake${dependentId ? '?dependent_id=' + encodeURIComponent(dependentId) : ''}`
          ),
    ]);
    if (alive.current) {
      setRecords(result.records);
      setBatches(saved);
    }
  }
  function applyPreview(value: ClinicalReview) {
    setPreview(value);
    setDraft(inputs(value));
    setAcknowledged(false);
    setEditingIndex(null);
    setNotice(null);
  }
  async function openBatch(id: string) {
    setBusy(true);
    setError(null);
    try {
      const value = await apiFetch<ClinicalReview>(
        '/api/clinical-intake/' + encodeURIComponent(id)
      );
      if (alive.current) {
        if (value.dependent_id !== dependentId) {
          setPreview(null);
          setError(
            'This saved batch belongs to a different person. Select that person before reviewing it.'
          );
          return;
        }
        applyPreview(value);
        setNotice('Saved preview reopened. Review current matches before approving.');
      }
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : 'Could not open saved preview.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    let canceled = false;
    refresh()
      .then(() => {
        if (canceled) return;
        const batch = params.get('batch_id');
        if (batch && !delegateOwnerId) void openBatch(batch);
      })
      .catch((error) => {
        if (!canceled)
          setError(error instanceof Error ? error.message : 'Could not load clinical records.');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
      alive.current = false;
    };
    // The wrapper remounts on subject/delegate change; do not reuse another subject's drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dirty = Boolean(preview && JSON.stringify(draft) !== JSON.stringify(inputs(preview)));
  const mismatch = Boolean(preview && preview.dependent_id !== dependentId);
  function change(index: number, patch: Partial<Item>) {
    setDraft((previous) => previous.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setAcknowledged(false);
  }
  async function stage(intake: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const parsed = intakeSchema.parse(intake);
      const value = await apiFetch<ClinicalReview>('/api/clinical-intake', {
        method: 'POST',
        body: JSON.stringify({ dependent_id: dependentId, intake: parsed }),
      });
      if (alive.current) {
        applyPreview(value);
        setNotice('Preview saved. No accepted record has changed.');
        await refresh();
      }
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : 'Could not stage the preview.');
      throw error;
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function submitManual(fact: ClinicalFact) {
    if (editingIndex !== null && preview) {
      const items = draft.map((item, i) => (i === editingIndex ? { ...item, fact } : item));
      await saveChoices(items);
      setEditingIndex(null);
      setFormVersion((v) => v + 1);
      return;
    }
    if (selected && !correctionReason.trim())
      throw new Error('Enter a reason for the selected correction.');
    const item: Item = {
      item_key: 'manual',
      action: selected ? 'correct' : 'add',
      fact,
      ...(selected
        ? {
            target_id: selected.id,
            expected_revision: selected.revision,
            reason: correctionReason.trim(),
          }
        : {}),
    };
    const payload = JSON.stringify(item);
    if (manualIdentity.current?.payload !== payload)
      manualIdentity.current = { payload, id: 'manual-' + crypto.randomUUID() };
    await stage({ external_id: manualIdentity.current.id, items: [item] });
  }
  async function saveChoices(items = draft) {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const value = await apiFetch<ClinicalReview>(
        '/api/clinical-intake/' + encodeURIComponent(preview.id),
        {
          method: 'PATCH',
          body: JSON.stringify({
            expected_version: preview.version,
            intake: { external_id: preview.external_id, items },
          }),
        }
      );
      if (alive.current) {
        applyPreview(value);
        setNotice('Updated exact preview saved. Review it again before approval.');
      }
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : 'Could not update preview.');
      throw error;
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function approve() {
    if (!preview || dirty || mismatch || !acknowledged || editingIndex !== null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<ClinicalReview>(
        '/api/clinical-intake/' + encodeURIComponent(preview.id) + '/approve',
        {
          method: 'POST',
          body: JSON.stringify({ version: preview.version, digest: preview.digest }),
        }
      );
      if (alive.current) {
        applyPreview(result);
        setNotice('Import outcomes saved. Repeating approval returns these same outcomes.');
        await refresh();
      }
    } catch (error) {
      if (alive.current) {
        setError(
          error instanceof Error
            ? error.message
            : 'Approval failed. Your preview and choices are retained.'
        );
        setAcknowledged(false);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function selectRecord(record: FidelityRecord) {
    setSeedFact(null);
    setSelected(record);
    setCorrectionReason('');
    setEditingIndex(null);
    setFormVersion((v) => v + 1);
    setMode('manual');
    document.getElementById('clinical-entry')?.scrollIntoView({ block: 'start' });
  }
  const formInitial =
    editingIndex !== null ? draft[editingIndex]?.fact : (selected?.fact ?? seedFact ?? undefined);
  function resolveHeld(fact: ClinicalFact) {
    setSeedFact(fact);
    setSelected(null);
    setEditingIndex(null);
    setFormVersion((v) => v + 1);
    setMode('manual');
    setNotice(
      'Verify the retained evidence, enter the supported outcome, then preview and approve the corrected fact.'
    );
  }
  return (
    <div className="space-y-6" style={{ color: 'var(--color-text-primary)' }}>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Clinical history and review</h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Preserve lab qualifiers, medication schedules and explicitly reported dose events. Preview
          first, then approve the exact records for <strong>{subject}</strong>.
        </p>
        <div className="flex gap-4 text-sm">
          <Link className="underline" href="/labs">
            Labs
          </Link>
          <Link className="underline" href="/medications">
            Medications
          </Link>
          <Link className="underline" href="/clinical-records">
            Detailed record history
          </Link>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-lg border p-3 break-words"
          style={{ borderColor: 'var(--color-terracotta)', color: 'var(--color-terracotta)' }}
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border p-3 text-sm"
          style={{ borderColor: 'var(--border-card)' }}
        >
          {notice}
        </p>
      )}
      {!delegateOwnerId &&
        params.get('document_id') &&
        !(preview?.documents ?? []).some((doc) => doc.id === params.get('document_id')) && (
          <TypedDocumentEvidence id={params.get('document_id')!} onResolve={resolveHeld} />
        )}
      {!delegateOwnerId &&
        (preview?.documents ?? []).map((document) => (
          <TypedDocumentEvidence
            key={`${document.id}:${preview!.approved_at ?? preview!.version}`}
            id={document.id}
            onResolve={resolveHeld}
          />
        ))}
      {delegateOwnerId ? (
        <Card>
          <h2 className="font-semibold">Owner approval is required</h2>
          <p className="text-sm">
            Existing sharing and delegate access can read permitted clinical history. New typed
            import approval is available only to the account owner.
          </p>
        </Card>
      ) : (
        <Card>
          <div id="clinical-entry" className="scroll-mt-20 space-y-3">
            <h2 className="text-lg font-semibold">
              {editingIndex !== null
                ? 'Edit preview item'
                : selected
                  ? 'Correct selected record'
                  : 'Add a clinical record'}
            </h2>
            <div className="flex flex-wrap gap-3">
              <button
                className={mode === 'manual' ? 'font-semibold underline' : 'underline'}
                type="button"
                onClick={() => setMode('manual')}
              >
                Structured entry
              </button>
              <button
                className={mode === 'json' ? 'font-semibold underline' : 'underline'}
                type="button"
                onClick={() => setMode('json')}
              >
                Typed JSON import
              </button>
            </div>
          </div>
          {mode === 'json' ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  void stage(JSON.parse(json)).catch(() => {});
                } catch {
                  setError('Enter valid typed intake JSON.');
                }
              }}
            >
              <label className="block space-y-1 text-sm">
                <span>Typed intake JSON (up to 100 items)</span>
                <textarea
                  name="typed_json"
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                  rows={12}
                  className={cls + ' font-mono text-xs'}
                  style={fieldStyle}
                  required
                />
              </label>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Use an external_id and items with stable item_key, action and typed fact.
                Unsupported fields are rejected. Existing IDs must be selected explicitly for
                link/correction.
              </p>
              <button
                type="submit"
                className="rounded-lg px-4 py-2 disabled:opacity-50"
                style={{ background: 'var(--color-terracotta)', color: 'white' }}
                disabled={busy}
              >
                {busy ? 'Saving preview…' : 'Preview typed JSON'}
              </button>
            </form>
          ) : (
            <>
              {(selected || editingIndex !== null) && (
                <div
                  className="rounded-lg border p-3 space-y-2"
                  style={{ borderColor: 'var(--border-card)' }}
                >
                  <p className="font-medium">
                    {editingIndex !== null
                      ? `Preview item ${editingIndex + 1}`
                      : selected && clinicalFactTitle(selected.fact)}
                  </p>
                  {selected && editingIndex === null && (
                    <>
                      <p className="text-xs">
                        {selected.legacy
                          ? 'Creates an audited typed correction over the preserved legacy original.'
                          : 'Retains the selected record ID and audits its previous values.'}
                      </p>
                      <label className="block text-sm space-y-1">
                        <span>Correction reason</span>
                        <textarea
                          className={cls}
                          style={fieldStyle}
                          value={correctionReason}
                          onChange={(e) => setCorrectionReason(e.target.value)}
                          rows={2}
                        />
                      </label>
                    </>
                  )}
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => {
                      setSelected(null);
                      setSeedFact(null);
                      setEditingIndex(null);
                      setCorrectionReason('');
                      setFormVersion((v) => v + 1);
                    }}
                  >
                    Cancel selection / start a new record
                  </button>
                </div>
              )}
              <ClinicalFactForm
                key={`${formVersion}:${selected?.id ?? 'new'}`}
                records={records}
                initial={formInitial}
                correction={Boolean(formInitial)}
                busy={busy}
                onSubmit={submitManual}
                submitLabel={
                  editingIndex !== null
                    ? 'Save revised preview'
                    : selected
                      ? 'Preview selected correction'
                      : 'Preview this record'
                }
              />
            </>
          )}
        </Card>
      )}
      {preview && (
        <Card>
          <h2 className="text-lg font-semibold">Exact preview · {preview.external_id}</h2>
          <p className="text-sm">
            Person:{' '}
            <strong>
              {mismatch ? 'Different selected person — switch profiles before approval' : subject}
            </strong>{' '}
            · Version {preview.version}
          </p>
          {mismatch && (
            <p role="alert" style={{ color: 'var(--color-terracotta)' }}>
              This batch belongs to a different person. Select that person using the profile
              selector; approval stays disabled.
            </p>
          )}
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Review the results, sources and matching records below. If anything changes, review
            again before approving.
          </p>
          {preview.coverage.map((warning) => (
            <p className="text-xs" key={warning} style={{ color: 'var(--color-text-muted)' }}>
              {warning}
            </p>
          ))}
          <ol className="space-y-4">
            {preview.items.map((item, index) => (
              <li
                className="rounded-lg border p-3 space-y-3"
                style={{ borderColor: 'var(--border-card)' }}
                key={item.item_key}
              >
                <h3 className="font-semibold break-words">
                  {index + 1}. {clinicalFactTitle(item.fact)}
                </h3>
                <ClinicalFactDetails fact={item.fact} />
                {item.matches.length > 0 && (
                  <details open>
                    <summary className="cursor-pointer font-medium text-sm">
                      Matching records ({item.matching_count ?? item.matches.length})
                    </summary>
                    <div className="space-y-3 mt-2">
                      {(item.matching_count ?? 0) > item.matches.length && (
                        <p className="text-sm">
                          Showing {item.matches.length} of {item.matching_count} possible matches.
                          Select the correct record from clinical history, or add separately with
                          a reason. Records are checked again when you save.
                        </p>
                      )}
                      {item.matches.map((match) => (
                        <div
                          className="rounded-lg border p-3 text-sm"
                          style={{ borderColor: 'var(--border-card)' }}
                          key={match.id}
                        >
                          <p className="font-medium">
                            {match.classification} ·{' '}
                            {match.legacy ? 'Legacy original' : 'Typed record'} ·{' '}
                            {match.id.slice(-8)}
                          </p>
                          <ClinicalFactDetails fact={match.fact} />
                          {match.legacy_conflict && (
                            <div
                              className="border-t mt-3 pt-3"
                              style={{ borderColor: 'var(--border-card)' }}
                            >
                              <p
                                className="font-semibold"
                                style={{ color: 'var(--color-terracotta)' }}
                              >
                                Legacy original changed after this typed correction.
                              </p>
                              {match.current_legacy && (
                                <ClinicalFactDetails fact={match.current_legacy} />
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {item.outcome ? (
                  <div
                    className="rounded-lg p-3 text-sm"
                    style={{ background: 'var(--bg-primary)' }}
                  >
                    <p className="font-semibold">{item.outcome.status}</p>
                    <p>{item.outcome.reason}</p>
                    {item.outcome.record_id && (
                      <a className="underline" href={'#record-' + item.outcome.record_id}>
                        Open matching record
                      </a>
                    )}
                  </div>
                ) : (
                  <>
                    <label className="block text-sm space-y-1">
                      <span>Decision for item {index + 1}</span>
                      <select
                        className={cls}
                        style={fieldStyle}
                        value={draft[index]?.action ?? item.action}
                        disabled={busy}
                        onChange={(e) =>
                          change(index, {
                            action: e.target.value as Item['action'],
                            target_id: undefined,
                            expected_revision: undefined,
                          })
                        }
                      >
                        <option value="add">
                          Add separately (confirmed duplicates will be skipped)
                        </option>
                        <option value="skip">Skip</option>
                        <option value="link">Link matching values / retain source evidence</option>
                        <option value="correct">Correct selected existing record</option>
                      </select>
                    </label>
                    {['correct', 'link'].includes(draft[index]?.action ?? item.action) && (
                      <label className="block text-sm space-y-1">
                        <span>Selected existing record</span>
                        <select
                          className={cls}
                          style={fieldStyle}
                          value={draft[index]?.target_id ?? ''}
                          disabled={busy}
                          onChange={(e) => {
                            const target = item.matches.find(
                              (match) => match.id === e.target.value
                            );
                            change(index, {
                              target_id: target?.id,
                              expected_revision: target?.revision,
                            });
                          }}
                        >
                          <option value="">Choose a record explicitly</option>
                          {item.matches.map((match) => (
                            <option key={match.id} value={match.id}>
                              {clinicalFactTitle(match.fact)} · {match.id.slice(-8)} ·{' '}
                              {match.classification}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="block text-sm space-y-1">
                      <span>Reason / why this is a separate record</span>
                      <textarea
                        rows={2}
                        className={cls}
                        style={fieldStyle}
                        value={draft[index]?.reason ?? ''}
                        onChange={(e) => change(index, { reason: e.target.value || undefined })}
                        placeholder="Required for corrections and adding separately when possible matches exist."
                      />
                    </label>
                    <button
                      type="button"
                      className="underline text-sm"
                      disabled={busy}
                      onClick={() => {
                        setEditingIndex(index);
                        setSelected(null);
                        setFormVersion((v) => v + 1);
                        setMode('manual');
                        setAcknowledged(false);
                        document
                          .getElementById('clinical-entry')
                          ?.scrollIntoView({ block: 'start' });
                      }}
                    >
                      Edit item values in structured form
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
          {preview.approved_at ? (
            <div className="space-y-3">
              <h3 className="font-semibold">Saved outcomes</h3>
              <p className="text-sm">
                {Object.entries(preview.counts)
                  .filter(([, count]) => count > 0)
                  .map(([status, count]) => `${status}: ${count}`)
                  .join(' · ')}
              </p>
              {preview.counts.unresolved > 0 && (
                <button
                  type="button"
                  className="underline text-sm"
                  disabled={busy}
                  onClick={() =>
                    void stage({
                      external_id: 'held-' + crypto.randomUUID(),
                      items: inputs(preview).filter(
                        (_, i) => preview.items[i].outcome?.status === 'unresolved'
                      ),
                    }).catch(() => {})
                  }
                >
                  Start a new review for held items only
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--border-card)' }}>
              {dirty && (
                <>
                  <p className="text-sm font-medium">
                    Review choices changed. Save them to receive a new exact preview.
                  </p>
                  <button
                    type="button"
                    className="rounded-lg border px-4 py-2 disabled:opacity-50"
                    style={{ borderColor: 'var(--border-card)' }}
                    disabled={busy || mismatch}
                    onClick={() => void saveChoices().catch(() => {})}
                  >
                    {busy ? 'Saving choices…' : 'Save review choices'}
                  </button>
                </>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  disabled={dirty || busy || mismatch || editingIndex !== null}
                />
                <span>
                  I reviewed this exact preview, the matching records and the selected person.
                </span>
              </label>
              <button
                type="button"
                className="rounded-lg px-4 py-2 disabled:opacity-50"
                style={{ background: 'var(--color-terracotta)', color: 'white' }}
                disabled={!acknowledged || dirty || busy || mismatch || editingIndex !== null}
                onClick={() => void approve()}
              >
                {busy ? 'Saving approved outcomes…' : 'Approve exact batch in HealthTrack'}
              </button>
            </div>
          )}
        </Card>
      )}
      {!delegateOwnerId && (
        <Card>
          <h2 className="text-lg font-semibold">Saved import previews</h2>
          {loading ? (
            <p role="status">Loading saved reviews…</p>
          ) : batches.length ? (
            <ul className="space-y-2">
              {batches.map((batch) => (
                <li key={batch.id}>
                  <button
                    type="button"
                    className="text-left underline break-words text-sm"
                    disabled={busy}
                    onClick={() => void openBatch(batch.id)}
                  >
                    {batch.external_id} ·{' '}
                    {batch.approved_at ? 'outcomes saved' : 'awaiting owner review'} ·{' '}
                    {Object.values(batch.counts).reduce((a, b) => a + b, 0)} items
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              No saved previews for this person.
            </p>
          )}
        </Card>
      )}
      <Card>
        <h2 className="text-lg font-semibold">Detailed clinical records</h2>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Current typed facts and explicit legacy adapters. Unknown historical precision remains
          unknown. Original numeric lists omit superseded originals; conflicts below show both
          versions.
        </p>
        {loading ? (
          <p role="status">Loading clinical history…</p>
        ) : records.length ? (
          <ul className="space-y-4">
            {records.map((record) => (
              <li
                className="rounded-lg border p-3 space-y-3 scroll-mt-20"
                id={'record-' + record.id}
                style={{ borderColor: 'var(--border-card)' }}
                key={record.id}
              >
                <h3 className="font-semibold break-words">{clinicalFactTitle(record.fact)}</h3>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {record.legacy
                    ? 'Legacy record — provenance/precision not backfilled'
                    : record.supersedes_legacy
                      ? 'Typed correction over a preserved original'
                      : 'Typed clinical record'}
                </p>
                {record.legacy_conflict && (
                  <p
                    role="alert"
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-terracotta)' }}
                  >
                    Conflict: the legacy original changed. Both versions remain visible until
                    explicitly reviewed.
                  </p>
                )}
                <ClinicalFactDetails fact={record.fact} record={record} />
                {!delegateOwnerId && (
                  <button
                    type="button"
                    className="underline text-sm"
                    disabled={busy}
                    onClick={() => selectRecord(record)}
                  >
                    Review a correction to this record
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">No clinical records for this person.</p>
        )}
        {records.length >= 1000 && (
          <p className="text-xs">
            Showing the first 1,000 records. Use typed API kind/limit filters for bounded review.
          </p>
        )}
      </Card>
    </div>
  );
}
