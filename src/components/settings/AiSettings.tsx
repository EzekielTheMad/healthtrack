'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/auth/client';
import { AI_PROVIDERS, type AiModel, type AiProvider } from '@/lib/ai/types';

interface SavedSettings {
  revision: string;
  provider: AiProvider | null;
  has_key: boolean;
  primary_model: string | null;
  extraction_model: string | null;
  models: AiModel[];
  tested_at: string | null;
  legacy_available: boolean;
}
const names = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Google Gemini' };
const fieldClass = 'block min-h-11 w-full rounded-lg border p-2 mt-1';
const fieldStyle = { backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-card)' };
type SettingsAction = 'discover' | 'test' | 'save' | 'remove' | 'migrate_legacy' | 'discard_draft';
const progress: Record<SettingsAction, string> = {
  discover: 'Refreshing models…',
  test: 'Testing connection and documents…',
  save: 'Saving AI settings…',
  remove: 'Removing saved API key…',
  migrate_legacy: 'Discovering legacy models…',
  discard_draft: 'Discarding setup draft…',
};

export default function AiSettings() {
  const { data: session } = useSession();
  return session?.user.id ? <AccountAiSettings key={session.user.id} /> : null;
}
function AccountAiSettings() {
  const [saved, setSaved] = useState<SavedSettings | null>(null);
  const [provider, setProvider] = useState<AiProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<AiModel[]>([]);
  const [primary, setPrimary] = useState('');
  const [extraction, setExtraction] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const [busy, setBusy] = useState<SettingsAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const invalidateRequests = useCallback(() => {
    generation.current++;
  }, []);

  function applySaved(value: SavedSettings) {
    setSaved(value);
    setProvider(value.provider ?? 'anthropic');
    setModels(value.models);
    setPrimary(value.primary_model ?? '');
    setExtraction(value.extraction_model ?? '');
    setApiKey('');
    setDraft(null);
    setTested(false);
  }
  useEffect(() => {
    const id = ++generation.current;
    fetch('/api/ai/settings', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('AI settings could not be loaded. Reload this page.');
        const value = (await res.json()) as SavedSettings;
        if (generation.current === id) applySaved(value);
      })
      .catch((e) => {
        if (generation.current === id) setError(e.message);
      });
    return invalidateRequests;
  }, [invalidateRequests]);

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }
  async function action(type: SettingsAction) {
    if (!saved || busy) return;
    const id = ++generation.current;
    setBusy(type);
    clearFeedback();
    const body =
      type === 'discover'
        ? {
            action: type,
            expected_revision: saved.revision,
            provider,
            ...(apiKey ? { api_key: apiKey } : {}),
          }
        : type === 'test'
          ? {
              action: type,
              draft_id: draft,
              primary_model: primary,
              extraction_model: extraction || null,
            }
          : type === 'save'
            ? {
                action: type,
                expected_revision: saved.revision,
                draft_id: draft,
                primary_model: primary,
                extraction_model: extraction || null,
              }
            : {
                action: type,
                expected_revision: saved.revision,
                ...(type === 'migrate_legacy' ? { confirm: true } : {}),
                ...(type === 'discard_draft' ? { draft_id: draft } : {}),
              };
    try {
      const res = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const value = await res.json();
      if (generation.current !== id) return;
      if (!res.ok) throw new Error(value.message ?? 'AI settings request failed. Try again.');
      if (type === 'discover' || type === 'migrate_legacy') {
        setDraft(value.draft_id);
        setModels(value.models);
        setTested(false);
        setApiKey('');
        if (type === 'migrate_legacy') {
          setProvider('anthropic');
          setPrimary('');
          setExtraction('');
        } else {
          if (!value.models.some((m: AiModel) => m.id === primary)) setPrimary('');
          if (!value.models.some((m: AiModel) => m.id === extraction)) setExtraction('');
        }
        setNotice('Models refreshed. Choose models and test this draft before saving.');
      } else if (type === 'test') {
        setTested(true);
        setNotice('Synthetic text, PDF and image requests passed. Save to use this selection.');
      } else {
        applySaved({ ...value, legacy_available: saved.legacy_available });
        setNotice(
          type === 'discard_draft'
            ? 'Setup draft discarded. Saved settings are unchanged.'
            : type === 'remove'
              ? 'API key removed. New AI requests are disabled.'
              : 'AI settings saved. New requests use this selection immediately.'
        );
        if (type !== 'discard_draft') window.dispatchEvent(new Event('healthtrack:ai-settings'));
      }
    } catch (e) {
      if (generation.current === id) {
        setError(e instanceof Error ? e.message : 'AI settings request failed.');
        if (type === 'test') setTested(false);
      }
    } finally {
      if (generation.current === id) setBusy(null);
    }
  }
  return (
    <section
      id="ai-settings"
      className="min-w-0 space-y-4 rounded-xl border p-4 sm:p-5"
      style={{ borderColor: 'var(--border-card)', backgroundColor: 'var(--bg-card)' }}
    >
      <h2 className="text-lg font-semibold">AI for your account</h2>
      <p className="text-sm">
        Choose your own provider and API key. Your saved key is encrypted on this server and is
        never shown again. Other accounts and delegates cannot use it.
      </p>
      <p className="text-sm">
        Using an AI feature sends the selected health information or document to this provider under
        its data policy. Refreshing models sends no health data. Testing sends only fictional text,
        a PDF and an image and may incur charges. Saving sends no health data.
      </p>
      {saved?.has_key && (
        <p className="text-sm break-words">
          Saved: {names[saved.provider!]} · {saved.primary_model}. Documents:{' '}
          {saved.extraction_model ?? 'same as primary'}. Key: ••••••••
        </p>
      )}
      {!saved && !error && <p role="status">Loading AI settings…</p>}
      {error && !saved && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}
      <fieldset disabled={!saved || Boolean(busy)} className="min-w-0 space-y-4">
        <label className="block text-sm">
          Provider
          <select
            value={provider}
            className={fieldClass}
            style={fieldStyle}
            onChange={(e) => {
              clearFeedback();
              setProvider(e.target.value as AiProvider);
              setApiKey('');
              setDraft(null);
              setModels([]);
              setPrimary('');
              setExtraction('');
              setTested(false);
            }}
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {names[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          {saved?.has_key && provider === saved.provider
            ? 'Replace API key (leave blank to keep saved key)'
            : 'API key'}
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            maxLength={4096}
            className={fieldClass}
            style={fieldStyle}
            onChange={(e) => {
              clearFeedback();
              setApiKey(e.target.value);
              setDraft(null);
              setTested(false);
            }}
          />
        </label>
        <button
          type="button"
          className="min-h-11 rounded-lg border px-3"
          onClick={() => void action('discover')}
          disabled={!apiKey && !(saved?.has_key && provider === saved.provider)}
        >
          {busy === 'discover' ? progress.discover : 'Refresh models'}
        </button>
        <label className="block text-sm">
          Primary model
          <select
            value={primary}
            className={fieldClass}
            style={fieldStyle}
            onChange={(e) => {
              clearFeedback();
              setPrimary(e.target.value);
              setTested(false);
            }}
          >
            <option value="">Choose a model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.id})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Document extraction model (optional)
          <select
            value={extraction}
            className={fieldClass}
            style={fieldStyle}
            onChange={(e) => {
              clearFeedback();
              setExtraction(e.target.value);
              setTested(false);
            }}
          >
            <option value="">Use primary model</option>
            {models
              .filter((m) => m.documents !== 'unsupported')
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
          </select>
        </label>
        <p className="text-xs">
          Model listings do not guarantee task support. Test confirms this exact key and model
          selection can accept text, PDF and image requests.
        </p>
        <div id="ai-settings-feedback" className="space-y-2">
          {error && saved && (
            <p role="alert" className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
              {error}
            </p>
          )}
          {(busy || notice) && (
            <p role="status" aria-atomic="true" className="text-sm">
              {busy ? progress[busy] : notice}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="min-h-11 rounded-lg border px-3"
            disabled={!draft || !primary}
            onClick={() => void action('test')}
          >
            {busy === 'test' ? progress.test : 'Test connection and documents'}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-lg border px-3"
            disabled={!draft || !tested}
            onClick={() => void action('save')}
          >
            {busy === 'save' ? progress.save : 'Save AI settings'}
          </button>
          {draft && (
            <button
              type="button"
              className="min-h-11 rounded-lg border px-3"
              onClick={() => void action('discard_draft')}
            >
              {busy === 'discard_draft' ? progress.discard_draft : 'Discard setup draft'}
            </button>
          )}
          {saved?.has_key && (
            <button
              type="button"
              className="min-h-11 rounded-lg border px-3"
              onClick={() => void action('remove')}
            >
              {busy === 'remove' ? progress.remove : 'Remove saved API key'}
            </button>
          )}
        </div>
        {saved?.legacy_available && (
          <details>
            <summary className="min-h-11 cursor-pointer text-sm">
              Administrator: migrate legacy Anthropic key
            </summary>
            <p className="text-sm">
              Copy the environment key into an encrypted draft for your account only. Choose models,
              test and save explicitly. Other accounts remain unconfigured. Remove the environment
              variable from your deployment separately after migration.
            </p>
            <button
              type="button"
              className="min-h-11 rounded-lg border px-3 mt-2"
              onClick={() => void action('migrate_legacy')}
            >
              {busy === 'migrate_legacy'
                ? progress.migrate_legacy
                : 'Copy legacy key and discover models'}
            </button>
          </details>
        )}
      </fieldset>
    </section>
  );
}
