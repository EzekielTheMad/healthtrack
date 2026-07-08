// @vitest-environment node
/**
 * appointments + notes repos — proves requireAuthz wiring. Neither section is
 * shareable (no has_health_share SELECT policy in 003), so shares grant
 * NOTHING here; delegates follow the standard 012 matrix (read read_only+,
 * write read_write+, delete admin). notes has NO updated_at column.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  insertShare,
  insertDelegate,
  OWNER,
  VIEWER,
  STRANGER,
  type RepoTestDb,
} from './repo-test-harness';

type ApptRepo = typeof import('./appointments');
type NotesRepo = typeof import('./notes');

let ctx: RepoTestDb;
let appts: ApptRepo;
let notes: NotesRepo;

const ownScope = { ownerId: OWNER, dependentId: null };

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-appts-notes-');
  appts = await import('./appointments');
  notes = await import('./notes');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('appointments repo', () => {
  it('owner CRUD round-trip, appointment_date desc', async () => {
    await appts.createAppointment(OWNER, ownScope, {
      appointmentDate: '2026-05-01T09:00:00.000Z',
      reason: 'Physical',
    });
    const later = await appts.createAppointment(OWNER, ownScope, {
      appointmentDate: '2026-08-01T09:00:00.000Z',
      reason: 'Follow-up',
    });

    const all = await appts.listAppointments(OWNER, ownScope);
    expect(all.map((a) => a.reason)).toEqual(['Follow-up', 'Physical']);

    const updated = await appts.updateAppointment(OWNER, later.id, {
      notes: 'bring records',
    });
    expect(updated.notes).toBe('bring records');
    expect(updated.updatedAt >= later.updatedAt).toBe(true);

    await appts.deleteAppointment(OWNER, later.id);
    expect(await appts.listAppointments(OWNER, ownScope)).toHaveLength(1);
  });

  it('dependent scoping is exact; shares grant nothing (not shareable)', async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    await appts.createAppointment(
      OWNER,
      { ownerId: OWNER, dependentId: depId },
      { appointmentDate: '2026-05-01T09:00:00.000Z' },
    );
    expect(await appts.listAppointments(OWNER, ownScope)).toHaveLength(0);
    expect(
      await appts.listAppointments(OWNER, { ownerId: OWNER, dependentId: depId }),
    ).toHaveLength(1);

    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['appointments'], // section string exists in UI, but 003 has no share policy
      dependentId: depId,
    });
    await expect(
      appts.listAppointments(VIEWER, { ownerId: OWNER, dependentId: depId }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('delegate matrix: read_write creates/updates in owner scope, delete needs admin', async () => {
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'read_write',
    });
    const created = await appts.createAppointment(VIEWER, ownScope, {
      appointmentDate: '2026-05-01T09:00:00.000Z',
    });
    expect(created.userId).toBe(OWNER);
    await appts.updateAppointment(VIEWER, created.id, { reason: 'moved' });
    await expect(appts.deleteAppointment(VIEWER, created.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('stranger denied; invalid input rejected; scope keys stripped', async () => {
    const row = await appts.createAppointment(OWNER, ownScope, {
      appointmentDate: '2026-05-01T09:00:00.000Z',
    });
    await expect(appts.listAppointments(STRANGER, ownScope)).rejects.toMatchObject({
      status: 404,
    });
    await expect(appts.createAppointment(OWNER, ownScope, {})).rejects.toThrow();
    const updated = await appts.updateAppointment(OWNER, row.id, {
      reason: 'x',
      userId: STRANGER,
      dependentId: crypto.randomUUID(),
    } as never);
    expect(updated.userId).toBe(OWNER);
    expect(updated.dependentId).toBeNull();
  });
});

describe('notes repo', () => {
  it('owner creates, lists (recorded_at desc) and deletes notes', async () => {
    await notes.createNote(OWNER, ownScope, {
      content: 'Headache in the morning',
      noteType: 'symptom',
      severity: 3,
      tags: ['head'],
      recordedAt: '2026-06-01T08:00:00.000Z',
    });
    const newer = await notes.createNote(OWNER, ownScope, {
      content: 'Felt fine',
      recordedAt: '2026-07-01T08:00:00.000Z',
    });
    expect(newer.noteType).toBe('general'); // default
    expect(newer.tags).toEqual([]); // default

    const all = await notes.listNotes(OWNER, ownScope);
    expect(all.map((n) => n.content)).toEqual(['Felt fine', 'Headache in the morning']);
    expect(all[1].severity).toBe(3);
    expect(all[1].tags).toEqual(['head']);

    await notes.deleteNote(OWNER, newer.id);
    expect(await notes.listNotes(OWNER, ownScope)).toHaveLength(1);
  });

  it('severity is bounded 1..5 (check-constraint parity via zod)', async () => {
    await expect(
      notes.createNote(OWNER, ownScope, { content: 'x', severity: 6 }),
    ).rejects.toThrow();
    await expect(
      notes.createNote(OWNER, ownScope, { content: 'x', severity: 0 }),
    ).rejects.toThrow();
  });

  it('shares grant nothing; delegate delete requires admin', async () => {
    const row = await notes.createNote(OWNER, ownScope, { content: 'private' });
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['notes'],
      dependentId: null,
    });
    await expect(notes.listNotes(VIEWER, ownScope)).rejects.toMatchObject({
      status: 404,
    });

    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'admin',
    });
    expect(
      await notes.listNotes(VIEWER, { ownerId: OWNER, dependentId: 'all' }),
    ).toHaveLength(1);
    await notes.deleteNote(VIEWER, row.id);
    expect(await notes.listNotes(OWNER, ownScope)).toHaveLength(0);
  });

  it('stranger denied on read and delete', async () => {
    const row = await notes.createNote(OWNER, ownScope, { content: 'private' });
    await expect(notes.listNotes(STRANGER, ownScope)).rejects.toMatchObject({
      status: 404,
    });
    await expect(notes.deleteNote(STRANGER, row.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});
