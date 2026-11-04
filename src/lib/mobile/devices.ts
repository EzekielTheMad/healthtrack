import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getSqlite } from '@/db';
import { generateApiKey, hasScope, validateApiKey } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { encrypt } from '@/lib/crypto/encrypt';
import { decrypt } from '@/lib/crypto/decrypt';
import { generateHmacSecret } from '@/lib/integrations/health-connect/signature';
import { getHealthTrackTimeZone } from '@/lib/oura/timezone';

export class MobileDeviceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code
  ) {
    super(message);
    this.name = 'MobileDeviceError';
  }
}

export function mobileErrorResponse(error: unknown): Response {
  if (error instanceof MobileDeviceError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: PRIVATE_HEADERS }
    );
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return Response.json(
      { error: 'Invalid request', code: 'validation_error' },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  }
  // Session errors have no health data. Do not serialize unknown errors or request bodies.
  if (error instanceof Error && error.name === 'UnauthorizedError') {
    return Response.json(
      { error: 'Sign in to continue', code: 'unauthorized' },
      { status: 401, headers: PRIVATE_HEADERS }
    );
  }
  return Response.json(
    { error: 'An unexpected error occurred', code: 'internal_error' },
    { status: 500, headers: PRIVATE_HEADERS }
  );
}

export const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
};
export const MOBILE_LIMITS = { max_body_bytes: 1048576, max_events: 500 };
export type MobileSubject = { id: string; name: string; kind: 'owner' | 'dependent' };
export interface MobileDeviceContext {
  id: string;
  userId: string;
  keyId: string;
  integrationId: string;
  generation: string;
  grantRevision: number;
  allowedSubjects: string[];
  hmacSecret: string;
}
export interface PairedMobileCredentials {
  device_id: string;
  user_id: string;
  account_name: string;
  token: string;
  hmac_secret: string;
  device_generation: string;
  grant_revision: number;
  allowed_subjects: MobileSubject[];
  timezone: string;
  protocol_version: number;
  limits: typeof MOBILE_LIMITS;
  next_sequence: number;
}
interface DeviceRow {
  id: string;
  user_id: string;
  integration_id: string | null;
  generation: string;
  key_id: string;
  hmac_secret_encrypted: string;
  grant_revision: number;
  allowed_subjects_json: string;
  name: string;
  created_at: string;
  last_contact_at: string | null;
  revoked_at: string | null;
}
interface PairingRow {
  id: string;
  device_name: string;
  code_challenge: string;
  expires_at: string;
  approved_by: string | null;
  approved_subjects_json: string;
  replace_existing: number;
  approved_at: string | null;
  redeemed_at: string | null;
}

export function mobileServerUrl(): string {
  const configured = process.env.APP_URL;
  if (!configured)
    throw new MobileDeviceError(
      503,
      'server_url_unconfigured',
      'Configure APP_URL before pairing a phone.'
    );
  const url = new URL(configured);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new MobileDeviceError(503, 'invalid_server_url', 'APP_URL must be an HTTP(S) origin.');
  }
  return url.origin;
}

/** Browser mutations require the configured origin; native endpoints use proof/Bearer instead. */
export function requireMobileOrigin(request: Request): void {
  if (request.headers.get('Origin') !== mobileServerUrl()) {
    throw new MobileDeviceError(
      403,
      'invalid_origin',
      'Open this action from your HealthTrack server.'
    );
  }
}

export async function mobileJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('Content-Length')) > 8192)
    throw new MobileDeviceError(413, 'body_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new MobileDeviceError(400, 'validation_error');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new MobileDeviceError(413, 'body_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function ownedMobileSubjects(userId: string): MobileSubject[] {
  const sql = getSqlite();
  const owner = sql.prepare('SELECT name FROM user WHERE id = ?').get(userId) as
    | { name: string }
    | undefined;
  if (!owner) throw new MobileDeviceError(401, 'account_unavailable');
  const profile = sql.prepare('SELECT display_name FROM profiles WHERE id = ?').get(userId) as
    | { display_name: string }
    | undefined;
  const dependents = sql
    .prepare('SELECT id, name FROM dependents WHERE parent_user_id = ? ORDER BY name, id')
    .all(userId) as { id: string; name: string }[];
  return [
    { id: 'self', name: profile?.display_name || owner.name, kind: 'owner' },
    ...dependents.map((d) => ({ ...d, kind: 'dependent' as const })),
  ];
}

export function isNativeDelivery(userId: string): boolean {
  const mode = getSqlite()
    .prepare('SELECT mode FROM mobile_delivery_modes WHERE user_id = ?')
    .get(userId) as { mode: string } | undefined;
  return mode?.mode === 'native';
}

/** Same synchronous connection/transaction as ingestion, so replacement cannot race a write. */
export function assertLegacyDelivery(userId: string): void {
  if (isNativeDelivery(userId))
    throw new MobileDeviceError(
      409,
      'native_delivery_active',
      'The paired Android app is the active delivery path. Restore the legacy relay in Mobile devices to use this endpoint.'
    );
}

function currentDevice(userId: string): DeviceRow | undefined {
  return getSqlite()
    .prepare('SELECT * FROM mobile_devices WHERE user_id = ? AND revoked_at IS NULL')
    .get(userId) as DeviceRow | undefined;
}

function requiresDeliveryReplacement(userId: string): boolean {
  return (
    !!currentDevice(userId) ||
    (!isNativeDelivery(userId) &&
      !!getSqlite()
        .prepare('SELECT id FROM health_connect_integrations WHERE user_id=?')
        .get(userId))
  );
}

function nativeServerUrl(): string {
  const origin = mobileServerUrl();
  if (!origin.startsWith('https://'))
    throw new MobileDeviceError(
      503,
      'https_required',
      'Android pairing requires an HTTPS APP_URL. LAN HTTP browser login remains available.'
    );
  return origin;
}

/** Revocation preserves all clinical and raw data and only revokes the phone's dedicated PAT. */
function revokeRow(device: DeviceRow, now: string): void {
  const sql = getSqlite();
  sql
    .prepare(
      'UPDATE mobile_devices SET revoked_at = ?, grant_revision = grant_revision + 1 WHERE id = ? AND revoked_at IS NULL'
    )
    .run(now, device.id);
  sql
    .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ?')
    .run(now, device.key_id, device.user_id);
}

export function revokeMobileDevice(userId: string, id: string): void {
  const sql = getSqlite();
  sql
    .transaction(() => {
      const device = sql
        .prepare('SELECT * FROM mobile_devices WHERE id = ? AND user_id = ?')
        .get(id, userId) as DeviceRow | undefined;
      if (!device) throw new MobileDeviceError(404, 'device_not_found');
      if (!device.revoked_at) revokeRow(device, new Date().toISOString());
      sql
        .prepare(
          'UPDATE mobile_delivery_modes SET device_id = NULL WHERE user_id = ? AND device_id = ?'
        )
        .run(userId, id);
    })
    .immediate();
}

export function restoreLegacyDelivery(userId: string): void {
  const sql = getSqlite();
  sql
    .transaction(() => {
      const device = currentDevice(userId);
      if (device) revokeRow(device, new Date().toISOString());
      sql
        .prepare(
          "INSERT INTO mobile_delivery_modes(user_id, mode, device_id) VALUES (?, 'legacy', NULL) ON CONFLICT(user_id) DO UPDATE SET mode='legacy', device_id=NULL"
        )
        .run(userId);
    })
    .immediate();
}

export function listMobileDevices(userId: string) {
  const subjects = ownedMobileSubjects(userId);
  const liveKeys = new Set(
    (
      getSqlite()
        .prepare(
          "SELECT id FROM api_keys WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))"
        )
        .all(userId) as { id: string }[]
    ).map((key) => key.id)
  );
  const rows = getSqlite()
    .prepare('SELECT * FROM mobile_devices WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(userId) as DeviceRow[];
  const integration = getSqlite()
    .prepare('SELECT id FROM health_connect_integrations WHERE user_id = ?')
    .get(userId);
  return {
    devices: rows.map((d) => ({
      id: d.id,
      name: d.name,
      status: d.revoked_at || !liveKeys.has(d.key_id) ? 'revoked' : 'active',
      last_sync_at:
        (
          getSqlite()
            .prepare('SELECT last_received_at FROM health_connect_native_state WHERE device_id = ?')
            .get(d.id) as { last_received_at: string | null } | undefined
        )?.last_received_at ?? null,
      created_at: d.created_at,
      offline_subjects: subjects.filter((s) =>
        (JSON.parse(d.allowed_subjects_json) as string[]).includes(s.id)
      ),
    })),
    legacy_delivery_active: !!integration && !isNativeDelivery(userId),
  };
}

function pairing(id: string): PairingRow {
  const row = getSqlite().prepare('SELECT * FROM mobile_pairings WHERE id = ?').get(id) as
    | PairingRow
    | undefined;
  if (!row) throw new MobileDeviceError(404, 'pairing_not_found');
  return row;
}

export function createMobilePairing(body: unknown, request: Request) {
  const input = z
    .object({
      device_name: z.string().trim().min(1).max(80),
      code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict()
    .parse(body);
  // Global cap also bounds requests behind proxies with unreliable client IP headers.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 80) || 'unknown';
  for (const key of ['mobile-pair:global', `mobile-pair:${ip}`]) {
    if (!checkRateLimit(key, { max: key.endsWith('global') ? 60 : 10, windowMs: 300000 }))
      throw new MobileDeviceError(429, 'rate_limited');
  }
  const serverUrl = nativeServerUrl();
  const id = randomUUID();
  const expires = new Date(Date.now() + 300000).toISOString();
  const sql = getSqlite();
  sql
    .prepare('DELETE FROM mobile_pairings WHERE expires_at < ?')
    .run(new Date(Date.now() - 86400000).toISOString());
  sql
    .prepare(
      'INSERT INTO mobile_pairings(id, device_name, code_challenge, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(id, input.device_name, input.code_challenge, expires, new Date().toISOString());
  return {
    request_id: id,
    verification_url: `${serverUrl}/mobile/pair?request_id=${id}`,
    expires_at: expires,
  };
}

export function getMobilePairing(id: string, user: { id: string; name: string; email: string }) {
  const row = pairing(id);
  if (row.approved_by && row.approved_by !== user.id)
    throw new MobileDeviceError(404, 'pairing_not_found');
  const active = currentDevice(user.id);
  const integration = getSqlite()
    .prepare('SELECT id FROM health_connect_integrations WHERE user_id = ?')
    .get(user.id);
  return {
    request_id: row.id,
    status: row.redeemed_at
      ? 'redeemed'
      : row.expires_at <= new Date().toISOString()
        ? 'expired'
        : row.approved_at
          ? 'approved'
          : 'pending',
    expires_at: row.expires_at,
    server_url: mobileServerUrl(),
    account: { id: user.id, name: user.name, email: user.email },
    device: { name: row.device_name },
    active_device: active ? { id: active.id, name: active.name } : null,
    legacy_delivery_active: !!integration && !isNativeDelivery(user.id),
    subjects: ownedMobileSubjects(user.id),
  };
}

export function approveMobilePairing(id: string, userId: string, body: unknown): void {
  const input = z
    .object({ replace_existing: z.boolean(), offline_subjects: z.array(z.string()).max(100) })
    .strict()
    .parse(body);
  const sql = getSqlite();
  sql
    .transaction(() => {
      const row = pairing(id);
      if (row.redeemed_at || row.expires_at <= new Date().toISOString())
        throw new MobileDeviceError(410, 'pairing_expired');
      if (row.approved_by && row.approved_by !== userId)
        throw new MobileDeviceError(404, 'pairing_not_found');
      const subjects = ownedMobileSubjects(userId);
      const grants = [...new Set(input.offline_subjects)].sort();
      if (grants.some((id) => !subjects.some((s) => s.id === id)))
        throw new MobileDeviceError(
          400,
          'invalid_subject',
          'Only your own profile and owned dependents can be saved offline.'
        );
      if (requiresDeliveryReplacement(userId) && !input.replace_existing) {
        throw new MobileDeviceError(
          409,
          'replacement_required',
          'Confirm switching Health Connect delivery to this phone.'
        );
      }
      sql
        .prepare(
          'UPDATE mobile_pairings SET approved_by=?, approved_subjects_json=?, replace_existing=?, approved_at=? WHERE id=?'
        )
        .run(
          userId,
          JSON.stringify(grants),
          Number(input.replace_existing),
          new Date().toISOString(),
          id
        );
    })
    .immediate();
}

export function redeemMobilePairing(
  id: string,
  body: unknown
): { status: 'pending' } | PairedMobileCredentials {
  nativeServerUrl();
  const { code_verifier: verifier } = z
    .object({ code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/) })
    .strict()
    .parse(body);
  if (!checkRateLimit(`mobile-redeem:${id}`, { max: 90, windowMs: 300000 }))
    throw new MobileDeviceError(429, 'rate_limited');
  const sql = getSqlite();
  return sql
    .transaction(() => {
      const row = pairing(id);
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!timingSafeEqual(Buffer.from(challenge), Buffer.from(row.code_challenge)))
        throw new MobileDeviceError(403, 'invalid_proof');
      if (row.redeemed_at || row.expires_at <= new Date().toISOString())
        throw new MobileDeviceError(410, 'pairing_expired');
      if (!row.approved_by) return { status: 'pending' as const };
      const userId = row.approved_by;
      const now = new Date().toISOString();
      const subjects = ownedMobileSubjects(userId);
      const grants = (JSON.parse(row.approved_subjects_json) as string[]).filter((id) =>
        subjects.some((s) => s.id === id)
      );
      const active = currentDevice(userId);
      let integration = sql
        .prepare('SELECT id FROM health_connect_integrations WHERE user_id=?')
        .get(userId) as { id: string } | undefined;
      if (requiresDeliveryReplacement(userId) && !row.replace_existing)
        throw new MobileDeviceError(409, 'replacement_required');
      if (active) revokeRow(active, now);
      if (!integration) {
        integration = { id: randomUUID() };
        sql
          .prepare(
            "INSERT INTO health_connect_integrations(id,user_id,name,status,hmac_secret_encrypted,allowed_sources_json,enabled_types_json,nutrition_strategy,created_at,updated_at) VALUES (?,?,'Android Health Connect','inventory',?,'{}','[]','sum_items',?,?)"
          )
          .run(integration.id, userId, encrypt(generateHmacSecret()), now, now);
      }
      const deviceId = randomUUID();
      const generation = randomUUID();
      const keyId = randomUUID();
      const secret = generateHmacSecret();
      const apiKey = generateApiKey();
      const scopes = ['write:health_connect', ...(grants.length ? ['read:doctor_summary'] : [])];
      sql
        .prepare(
          'INSERT INTO api_keys(id,user_id,name,token_hash,prefix,scopes,created_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run(
          keyId,
          userId,
          `Android: ${row.device_name}`,
          apiKey.hash,
          apiKey.prefix,
          JSON.stringify(scopes),
          now
        );
      sql
        .prepare(
          'INSERT INTO mobile_devices(id,user_id,integration_id,generation,key_id,hmac_secret_encrypted,grant_revision,allowed_subjects_json,name,created_at) VALUES (?,?,?,?,?,?,1,?,?,?)'
        )
        .run(
          deviceId,
          userId,
          integration.id,
          generation,
          keyId,
          encrypt(secret),
          JSON.stringify(grants),
          row.device_name,
          now
        );
      sql
        .prepare(
          "INSERT INTO mobile_delivery_modes(user_id,mode,device_id) VALUES (?,'native',?) ON CONFLICT(user_id) DO UPDATE SET mode='native',device_id=excluded.device_id"
        )
        .run(userId, deviceId);
      sql.prepare('UPDATE mobile_pairings SET redeemed_at=? WHERE id=?').run(now, id);
      return {
        device_id: deviceId,
        user_id: userId,
        account_name: subjects[0].name,
        token: apiKey.token,
        hmac_secret: secret,
        device_generation: generation,
        grant_revision: 1,
        allowed_subjects: subjects.filter((s) => grants.includes(s.id)),
        timezone: getHealthTrackTimeZone(),
        protocol_version: 2,
        limits: MOBILE_LIMITS,
        next_sequence: 1,
      };
    })
    .immediate();
}

export async function requireMobileDevice(
  request: Request,
  scope = 'write:health_connect'
): Promise<MobileDeviceContext> {
  const key = await validateApiKey(request.headers.get('Authorization'));
  if (!key) throw new MobileDeviceError(401, 'device_unauthorized', 'Pair this phone again.');
  if (!hasScope(key, scope)) throw new MobileDeviceError(403, 'scope_required');
  const sql = getSqlite();
  return sql
    .transaction(() => {
      const row = sql
        .prepare(
          "SELECT d.* FROM mobile_devices d JOIN mobile_delivery_modes m ON m.user_id=d.user_id AND m.device_id=d.id AND m.mode='native' JOIN api_keys k ON k.id=d.key_id AND k.user_id=d.user_id WHERE d.key_id=? AND d.user_id=? AND d.revoked_at IS NULL AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR julianday(k.expires_at)>julianday('now'))"
        )
        .get(key.keyId, key.userId) as DeviceRow | undefined;
      if (!row || !row.integration_id)
        throw new MobileDeviceError(401, 'device_revoked', 'This phone is no longer paired.');
      const existing = JSON.parse(row.allowed_subjects_json) as string[];
      const current = ownedMobileSubjects(key.userId).map((s) => s.id);
      const allowed = existing.filter((id) => current.includes(id));
      if (allowed.length !== existing.length) {
        row.grant_revision++;
        sql
          .prepare('UPDATE mobile_devices SET allowed_subjects_json=?,grant_revision=? WHERE id=?')
          .run(JSON.stringify(allowed), row.grant_revision, row.id);
      }
      sql
        .prepare('UPDATE mobile_devices SET last_contact_at=? WHERE id=?')
        .run(new Date().toISOString(), row.id);
      return {
        id: row.id,
        userId: row.user_id,
        keyId: row.key_id,
        integrationId: row.integration_id,
        generation: row.generation,
        grantRevision: row.grant_revision,
        allowedSubjects: allowed,
        hmacSecret: decrypt(row.hmac_secret_encrypted),
      };
    })
    .immediate();
}

export function mobileState(device: MobileDeviceContext) {
  const sql = getSqlite();
  const row = sql
    .prepare('SELECT name,last_contact_at FROM mobile_devices WHERE id=?')
    .get(device.id) as { name: string; last_contact_at: string | null };
  const state = sql
    .prepare(
      'SELECT last_sequence,last_read_at,last_received_at FROM health_connect_native_state WHERE device_id=?'
    )
    .get(device.id) as
    | { last_sequence: number; last_read_at: string | null; last_received_at: string | null }
    | undefined;
  const integration = sql
    .prepare(
      'SELECT status,allowed_sources_json,enabled_types_json FROM health_connect_integrations WHERE id=? AND user_id=?'
    )
    .get(device.integrationId, device.userId) as {
    status: string;
    allowed_sources_json: string;
    enabled_types_json: string;
  };
  return {
    device_id: device.id,
    user_id: device.userId,
    device_name: row.name,
    device_generation: device.generation,
    grant_revision: device.grantRevision,
    allowed_subjects: ownedMobileSubjects(device.userId).filter((s) =>
      device.allowedSubjects.includes(s.id)
    ),
    timezone: getHealthTrackTimeZone(),
    protocol_version: 2,
    limits: MOBILE_LIMITS,
    native_last_sequence: state?.last_sequence ?? 0,
    next_sequence: (state?.last_sequence ?? 0) + 1,
    last_contact_at: row.last_contact_at,
    last_received_at: state?.last_received_at ?? null,
    last_read_at: state?.last_read_at ?? null,
    mode: 'native',
    integration_status: integration.status,
    allowed_sources: JSON.parse(integration.allowed_sources_json),
    enabled_types: JSON.parse(integration.enabled_types_json),
  };
}
