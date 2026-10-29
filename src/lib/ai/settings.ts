import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getSqlite } from '@/db';
import { encrypt } from '@/lib/crypto/encrypt';
import { decrypt } from '@/lib/crypto/decrypt';
import { AiError } from './errors';
import { discoverModels, generateText } from './provider';
import { type AiConfiguration, type AiModel, type AiProvider } from './types';

interface SettingsRow {
  user_id: string;
  revision: string;
  provider: AiProvider | null;
  encrypted_key: string | null;
  primary_model: string | null;
  extraction_model: string | null;
  models_json: string;
  tested_at: string | null;
  updated_at: string;
}
interface DraftRow {
  user_id: string;
  id: string;
  base_revision: string;
  provider: AiProvider;
  encrypted_key: string;
  models_json: string;
  test_id: string | null;
  tested_selection: string | null;
  tested_at: string | null;
  expires_at: number;
}
export function readAiSettings(userId: string) {
  if (!userId) throw new AiError('not_configured');
  const row = getSqlite().prepare('SELECT * FROM ai_settings WHERE user_id=?').get(userId) as
    | SettingsRow
    | undefined;
  return {
    revision: row?.revision ?? 'unconfigured',
    provider: row?.provider ?? null,
    has_key: Boolean(row?.encrypted_key),
    primary_model: row?.primary_model ?? null,
    extraction_model: row?.extraction_model ?? null,
    models: JSON.parse(row?.models_json ?? '[]') as AiModel[],
    tested_at: row?.tested_at ?? null,
    updated_at: row?.updated_at ?? null,
  };
}
export function hasAiConfiguration(userId: string): boolean {
  if (!userId) return false;
  const value = readAiSettings(userId);
  return value.has_key && !!value.provider && !!value.primary_model;
}
function assertRevision(userId: string, expected: string) {
  if (readAiSettings(userId).revision !== expected) throw new AiError('changed');
}
function decode(value: string): string {
  try {
    return decrypt(value);
  } catch {
    throw new AiError('key_unreadable');
  }
}
export function resolveAiConfiguration(userId: string): AiConfiguration {
  const row = getSqlite().prepare('SELECT * FROM ai_settings WHERE user_id=?').get(userId) as
    | SettingsRow
    | undefined;
  if (!userId || !row?.encrypted_key || !row.provider || !row.primary_model)
    throw new AiError('not_configured');
  return {
    userId,
    revision: row.revision,
    provider: row.provider,
    primaryModel: row.primary_model,
    extractionModel: row.extraction_model,
    apiKey: decode(row.encrypted_key),
  };
}
export function assertCurrentAiConfiguration(config: Pick<AiConfiguration, 'userId' | 'revision'>) {
  assertRevision(config.userId, config.revision);
}
/** A synchronous callback keeps the revision check and writes in one transaction. */
export function withCurrentAiConfiguration<T>(
  config: Pick<AiConfiguration, 'userId' | 'revision'>,
  write: () => T
): T {
  return getSqlite().transaction(() => {
    assertCurrentAiConfiguration(config);
    return write();
  })();
}
function loadDraft(userId: string, id: string): DraftRow {
  const row = getSqlite()
    .prepare('SELECT * FROM ai_setting_drafts WHERE user_id=? AND id=?')
    .get(userId, id) as DraftRow | undefined;
  if (!row || row.expires_at <= Date.now()) throw new AiError('draft_expired');
  assertRevision(userId, row.base_revision);
  return row;
}
function keyFor(userId: string, provider: AiProvider, key?: string): string {
  if (key !== undefined) {
    const trimmed = key.trim();
    if (trimmed.length < 8 || trimmed.length > 4096 || /\s|[\x00-\x1f]/.test(trimmed))
      throw new AiError('invalid_settings');
    return trimmed;
  }
  const config = resolveAiConfiguration(userId);
  if (config.provider !== provider) throw new AiError('invalid_settings');
  return config.apiKey;
}
export async function refreshAiModels(
  userId: string,
  expected: string,
  provider: AiProvider,
  apiKey?: string
) {
  assertRevision(userId, expected);
  const key = keyFor(userId, provider, apiKey);
  const id = randomUUID();
  const sqlite = getSqlite();
  sqlite.transaction(() => {
    assertRevision(userId, expected);
    sqlite.prepare('DELETE FROM ai_setting_drafts WHERE expires_at<=?').run(Date.now());
    sqlite
      .prepare(
        `INSERT INTO ai_setting_drafts(user_id,id,base_revision,provider,encrypted_key,expires_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,base_revision=excluded.base_revision,
      provider=excluded.provider,encrypted_key=excluded.encrypted_key,expires_at=excluded.expires_at,
      models_json='[]',test_id=NULL,tested_selection=NULL,tested_at=NULL`
      )
      .run(userId, id, expected, provider, encrypt(key), Date.now() + 30 * 60_000);
  })();
  try {
    const models = await discoverModels(provider, key);
    loadDraft(userId, id);
    sqlite
      .prepare('UPDATE ai_setting_drafts SET models_json=? WHERE user_id=? AND id=?')
      .run(JSON.stringify(models), userId, id);
    return { draft_id: id, models };
  } catch (error) {
    sqlite.prepare('DELETE FROM ai_setting_drafts WHERE user_id=? AND id=?').run(userId, id);
    throw error;
  }
}
function selection(draft: DraftRow, primary: string, extraction: string | null) {
  const models = JSON.parse(draft.models_json) as AiModel[];
  if (
    !models.some((m) => m.id === primary) ||
    !models.some((m) => m.id === (extraction ?? primary) && m.documents !== 'unsupported')
  )
    throw new AiError('model_unavailable');
  return JSON.stringify([primary, extraction]);
}
/** Explicit synthetic text, fictional one-page PDF and image; no account data. */
export async function testAiDraft(
  userId: string,
  id: string,
  primary: string,
  extraction: string | null
) {
  const draft = loadDraft(userId, id);
  const selected = selection(draft, primary, extraction);
  const testId = randomUUID();
  getSqlite()
    .prepare(
      'UPDATE ai_setting_drafts SET test_id=?,tested_selection=NULL,tested_at=NULL WHERE user_id=? AND id=?'
    )
    .run(testId, userId, id);
  const key = decode(draft.encrypted_key);
  const assertTest = () => {
    if (loadDraft(userId, id).test_id !== testId) throw new AiError('changed');
  };
  const text = await generateText(draft.provider, key, primary, {
    system: 'This is a synthetic connection test. Reply exactly HEALTHTRACK_TEST_OK.',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'HEALTHTRACK_TEST_OK' }],
  });
  assertTest();
  if (!text.includes('HEALTHTRACK_TEST_OK')) throw new AiError('invalid_response');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([250, 100])
    .drawText('Fictional test: HEALTHTRACK_TEST_OK', { x: 10, y: 50, size: 10, font });
  const pdfData = Buffer.from(await pdf.save()).toString('base64');
  assertTest();
  const document = await generateText(draft.provider, key, extraction ?? primary, {
    system:
      'This PDF and image contain no patient data. Read the PDF and reply exactly HEALTHTRACK_TEST_OK.',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfData },
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH9sAAAAASUVORK5CYII=',
            },
          },
          { type: 'text', text: 'Confirm the test text in the attached fictional PDF.' },
        ],
      },
    ],
  });
  assertTest();
  if (!document.includes('HEALTHTRACK_TEST_OK')) throw new AiError('invalid_response');
  const testedAt = new Date().toISOString();
  getSqlite()
    .prepare(
      'UPDATE ai_setting_drafts SET tested_selection=?,tested_at=? WHERE user_id=? AND id=? AND test_id=?'
    )
    .run(selected, testedAt, userId, id, testId);
  return { tested_at: testedAt, primary_model: primary, extraction_model: extraction };
}
export function saveAiDraft(
  userId: string,
  expected: string,
  id: string,
  primary: string,
  extraction: string | null
) {
  const sqlite = getSqlite();
  sqlite.transaction(() => {
    assertRevision(userId, expected);
    const draft = loadDraft(userId, id);
    if (!draft.tested_at || draft.tested_selection !== selection(draft, primary, extraction))
      throw new AiError('test_required');
    sqlite
      .prepare(
        `INSERT INTO ai_settings(user_id,revision,provider,encrypted_key,primary_model,extraction_model,models_json,tested_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,provider=excluded.provider,
      encrypted_key=excluded.encrypted_key,primary_model=excluded.primary_model,extraction_model=excluded.extraction_model,
      models_json=excluded.models_json,tested_at=excluded.tested_at,updated_at=excluded.updated_at`
      )
      .run(
        userId,
        randomUUID(),
        draft.provider,
        draft.encrypted_key,
        primary,
        extraction,
        draft.models_json,
        draft.tested_at,
        new Date().toISOString()
      );
    sqlite.prepare('DELETE FROM ai_setting_drafts WHERE user_id=?').run(userId);
  })();
  return readAiSettings(userId);
}
export function removeAiSettings(userId: string, expected: string) {
  const sqlite = getSqlite();
  sqlite.transaction(() => {
    assertRevision(userId, expected);
    sqlite
      .prepare(
        `INSERT INTO ai_settings(user_id,revision,updated_at) VALUES(?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,provider=NULL,encrypted_key=NULL,
      primary_model=NULL,extraction_model=NULL,models_json='[]',tested_at=NULL,updated_at=excluded.updated_at`
      )
      .run(userId, randomUUID(), new Date().toISOString());
    sqlite.prepare('DELETE FROM ai_setting_drafts WHERE user_id=?').run(userId);
  })();
  return readAiSettings(userId);
}

export function discardAiDraft(userId: string, expected: string, id: string) {
  assertRevision(userId, expected);
  getSqlite().prepare('DELETE FROM ai_setting_drafts WHERE user_id=? AND id=?').run(userId, id);
  return readAiSettings(userId);
}
