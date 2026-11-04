// @vitest-environment node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  mintApiToken,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

let db: RepoTestDb;
let mobile: typeof import('./devices');
let oldUrl: string | undefined;
const origin = 'https://healthtrack.example';
beforeEach(async () => {
  oldUrl = process.env.APP_URL;
  process.env.APP_URL = origin;
  db = await setupRepoDb('healthtrack-mobile-');
  insertUser(db.sqlite, OWNER);
  insertUser(db.sqlite, VIEWER, 'viewer@example.com');
  mobile = await import('./devices');
});
afterEach(() => {
  db.restore();
  if (oldUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = oldUrl;
});

function pending() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const pair = mobile.createMobilePairing(
    { device_name: 'Test phone', code_challenge: challenge },
    new Request(`${origin}/api/mobile/pairing`, { headers: { 'x-forwarded-for': randomUUID() } })
  );
  return { verifier, pair };
}
function paired(subjects = ['self'], owner = OWNER) {
  const { verifier, pair } = pending();
  mobile.approveMobilePairing(pair.request_id, owner, {
    replace_existing: true,
    offline_subjects: subjects,
  });
  const result = mobile.redeemMobilePairing(pair.request_id, { code_verifier: verifier });
  if (!('token' in result)) throw new Error('Expected paired device');
  return result;
}
function bearer(token: string, path = '/api/v1/mobile/state') {
  return new Request(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

describe('private phone pairing and authorization', () => {
  it('reflects API-key revocation in phone management and rejects the credential', async () => {
    const phone = paired();
    db.sqlite
      .prepare(
        'UPDATE api_keys SET revoked_at=? WHERE id=(SELECT key_id FROM mobile_devices WHERE id=?)'
      )
      .run(new Date().toISOString(), phone.device_id);
    expect(mobile.listMobileDevices(OWNER).devices[0].status).toBe('revoked');
    await expect(mobile.requireMobileDevice(bearer(phone.token))).rejects.toMatchObject({
      status: 401,
    });
  });
  it('requires proof, consent and one-time redemption without leaking credentials in browser responses', async () => {
    const { verifier, pair } = pending();
    expect(mobile.redeemMobilePairing(pair.request_id, { code_verifier: verifier })).toEqual({
      status: 'pending',
    });
    expect(() =>
      mobile.redeemMobilePairing(pair.request_id, {
        code_verifier: randomBytes(48).toString('base64url'),
      })
    ).toThrow('invalid_proof');
    mobile.approveMobilePairing(pair.request_id, OWNER, {
      replace_existing: false,
      offline_subjects: ['self'],
    });
    const detail = mobile.getMobilePairing(pair.request_id, {
      id: OWNER,
      name: 'Owner',
      email: 'owner@example.com',
    });
    expect(JSON.stringify(detail)).not.toMatch(/ohts_pat_|hmac_secret|code_challenge/);
    const result = mobile.redeemMobilePairing(pair.request_id, { code_verifier: verifier });
    expect(result).toMatchObject({ user_id: OWNER, protocol_version: 2, grant_revision: 1 });
    expect(() => mobile.redeemMobilePairing(pair.request_id, { code_verifier: verifier })).toThrow(
      'pairing_expired'
    );
    const stored = db.sqlite.prepare('SELECT * FROM mobile_devices').get() as Record<
      string,
      string
    >;
    expect(JSON.stringify(stored)).not.toContain('token' in result ? result.token : 'bad');
    expect(stored.hmac_secret_encrypted).not.toBe(
      'hmac_secret' in result ? result.hmac_secret : 'bad'
    );
  });

  it('rejects foreign dependent grants and foreign browser account approval', () => {
    const foreign = randomUUID();
    insertDependent(db.sqlite, foreign, VIEWER);
    const { pair } = pending();
    expect(() =>
      mobile.approveMobilePairing(pair.request_id, OWNER, {
        replace_existing: false,
        offline_subjects: [foreign],
      })
    ).toThrow('Only your own');
    mobile.approveMobilePairing(pair.request_id, OWNER, {
      replace_existing: false,
      offline_subjects: [],
    });
    expect(() =>
      mobile.approveMobilePairing(pair.request_id, VIEWER, {
        replace_existing: true,
        offline_subjects: [],
      })
    ).toThrow('pairing_not_found');
    expect(() =>
      mobile.requireMobileOrigin(
        new Request(origin, { headers: { Origin: 'https://elsewhere.example' } })
      )
    ).toThrow('Open this action');
  });

  it('requires explicit replacement, fences old native generations and keeps shared relay keys intact', async () => {
    const relay = mintApiToken(db.sqlite, OWNER, ['write:health_connect']);
    const first = paired();
    await expect(mobile.requireMobileDevice(bearer(first.token))).resolves.toMatchObject({
      userId: OWNER,
      id: first.device_id,
    });
    expect(() => mobile.assertLegacyDelivery(OWNER)).toThrow('paired Android app');
    const next = pending();
    expect(() =>
      mobile.approveMobilePairing(next.pair.request_id, OWNER, {
        replace_existing: false,
        offline_subjects: [],
      })
    ).toThrow('Confirm switching');
    mobile.approveMobilePairing(next.pair.request_id, OWNER, {
      replace_existing: true,
      offline_subjects: [],
    });
    const second = mobile.redeemMobilePairing(next.pair.request_id, {
      code_verifier: next.verifier,
    });
    if (!('token' in second)) throw new Error('Not paired');
    await expect(mobile.requireMobileDevice(bearer(first.token))).rejects.toMatchObject({
      status: 401,
    });
    await expect(mobile.requireMobileDevice(bearer(second.token))).resolves.toMatchObject({
      id: second.device_id,
    });
    expect(
      db.sqlite.prepare('SELECT count(*) AS n FROM mobile_devices WHERE revoked_at IS NULL').get()
    ).toEqual({ n: 1 });
    const { validateApiKey } = await import('@/lib/api-auth');
    expect(await validateApiKey(`Bearer ${relay}`)).toBeTruthy();
    mobile.restoreLegacyDelivery(OWNER);
    expect(mobile.isNativeDelivery(OWNER)).toBe(false);
    await expect(mobile.requireMobileDevice(bearer(second.token))).rejects.toMatchObject({
      status: 401,
    });
    expect(await validateApiKey(`Bearer ${relay}`)).toBeTruthy();
    expect(
      db.sqlite.prepare('SELECT count(*) AS n FROM health_connect_integrations').get()
    ).toEqual({ n: 1 });
  });

  it('does not let an unrelated broad PAT become a mobile device', async () => {
    const unrelated = mintApiToken(db.sqlite, OWNER, ['read:all', 'write:all']);
    await expect(mobile.requireMobileDevice(bearer(unrelated))).rejects.toMatchObject({
      status: 401,
    });
    const phone = paired([]);
    await expect(
      mobile.requireMobileDevice(bearer(phone.token), 'read:doctor_summary')
    ).rejects.toMatchObject({ status: 403 });
  });

  it('removes revoked ownership grants and increments revision on contact', async () => {
    const dep = randomUUID();
    insertDependent(db.sqlite, dep, OWNER);
    const phone = paired(['self', dep]);
    db.sqlite.prepare('UPDATE dependents SET parent_user_id=? WHERE id=?').run(VIEWER, dep);
    const current = await mobile.requireMobileDevice(bearer(phone.token));
    expect(current.allowedSubjects).toEqual(['self']);
    expect(current.grantRevision).toBe(2);
    expect(mobile.mobileState(current)).toMatchObject({
      user_id: OWNER,
      next_sequence: 1,
      allowed_subjects: [{ id: 'self' }],
    });
    mobile.revokeMobileDevice(OWNER, phone.device_id);
    expect(mobile.isNativeDelivery(OWNER)).toBe(true);
    await expect(mobile.requireMobileDevice(bearer(phone.token))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('can pair again after revocation without an invisible replacement requirement', () => {
    const first = paired();
    mobile.revokeMobileDevice(OWNER, first.device_id);
    const next = pending();
    const detail = mobile.getMobilePairing(next.pair.request_id, {
      id: OWNER,
      name: 'Owner',
      email: 'owner@example.com',
    });
    expect(detail.active_device).toBeNull();
    expect(detail.legacy_delivery_active).toBe(false);
    mobile.approveMobilePairing(next.pair.request_id, OWNER, {
      replace_existing: false,
      offline_subjects: [],
    });
    expect(
      mobile.redeemMobilePairing(next.pair.request_id, { code_verifier: next.verifier })
    ).toHaveProperty('token');
  });

  it('bounds streamed public request bodies and requires HTTPS only for native pairing', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8193));
        controller.close();
      },
    });
    const request = new Request(`${origin}/api/mobile/pairing`, {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);
    await expect(mobile.mobileJson(request)).rejects.toMatchObject({ status: 413 });
    process.env.APP_URL = 'http://192.0.2.1:3000';
    expect(() => pending()).toThrow('Android pairing requires an HTTPS');
    expect(() =>
      mobile.requireMobileOrigin(
        new Request('http://192.0.2.1:3000', { headers: { Origin: 'http://192.0.2.1:3000' } })
      )
    ).not.toThrow();
  });
});

describe('offline Doctor Essentials authorization and content agreement', () => {
  it('keeps dependent records separate and changes fingerprints after a correction', async () => {
    const dep = randomUUID();
    insertDependent(db.sqlite, dep, OWNER);
    const phone = paired(['self', dep]);
    const { mobileDoctorBundle } = await import('./doctor');
    const { createMedication, updateMedication } = await import('@/lib/repos/medications');
    const med = await createMedication(
      OWNER,
      { ownerId: OWNER, dependentId: null },
      { name: 'Synthetic owner medicine', dosage: '5 mg', startDate: '2020-01-02' }
    );
    await createMedication(
      OWNER,
      { ownerId: OWNER, dependentId: dep },
      { name: 'Synthetic child medicine', startDate: null }
    );
    const before = await mobileDoctorBundle(
      bearer(phone.token, '/api/v1/mobile/doctor-summary?subject=self')
    );
    const child = await mobileDoctorBundle(
      bearer(phone.token, `/api/v1/mobile/doctor-summary?subject=${dep}`)
    );
    expect(JSON.stringify(before)).toContain('Synthetic owner medicine');
    expect(JSON.stringify(before)).not.toContain('Synthetic child medicine');
    expect(JSON.stringify(child)).toContain('Synthetic child medicine');
    expect(JSON.stringify(child)).not.toContain('Synthetic owner medicine');
    const unchanged = await mobileDoctorBundle(
      bearer(phone.token, '/api/v1/mobile/doctor-summary?subject=self')
    );
    expect(unchanged.fingerprint).toBe(before.fingerprint);
    await updateMedication(OWNER, med.id, { startDate: '2020-02-03' });
    const corrected = await mobileDoctorBundle(
      bearer(phone.token, '/api/v1/mobile/doctor-summary?subject=self')
    );
    expect(corrected.fingerprint).not.toBe(before.fingerprint);
    const pdf = await import('@/app/api/v1/mobile/doctor-summary/pdf/route');
    expect(
      (
        await pdf.GET(
          bearer(
            phone.token,
            `/api/v1/mobile/doctor-summary/pdf?subject=self&fingerprint=${before.fingerprint}`
          )
        )
      ).status
    ).toBe(409);
    const currentPdf = await pdf.GET(
      bearer(
        phone.token,
        `/api/v1/mobile/doctor-summary/pdf?subject=self&fingerprint=${corrected.fingerprint}`
      )
    );
    expect(currentPdf.status).toBe(200);
    expect(currentPdf.headers.get('etag')).toBe(`"${corrected.fingerprint}"`);
    expect(
      Buffer.from(await currentPdf.arrayBuffer())
        .subarray(0, 4)
        .toString()
    ).toBe('%PDF');
    await expect(
      mobileDoctorBundle(bearer(phone.token, '/api/v1/mobile/doctor-summary?subject=someone-else'))
    ).rejects.toMatchObject({ status: 404 });
  });
});
