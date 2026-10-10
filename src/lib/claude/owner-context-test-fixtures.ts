/** Synthetic-only sentinels shared by the summary/chat boundary regressions. */
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { insertDependent, insertUser, OWNER, STRANGER } from '@/lib/repos/repo-test-harness';

export function seedOwnerAiSentinels(sqlite: Database.Database, includeOwner = true) {
  insertUser(sqlite, STRANGER);
  const dependents = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of dependents) insertDependent(sqlite, id, OWNER);
  const now = new Date().toISOString();
  const recent = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const ownerDate = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const people = [
    ...(includeOwner
      ? [{ userId: OWNER, dependentId: null, tag: 'SELF_SENTINEL', value: 181 }]
      : []),
    { userId: OWNER, dependentId: dependents[0], tag: 'DEP_ONE_SENTINEL', value: 61 },
    { userId: OWNER, dependentId: dependents[1], tag: 'DEP_TWO_SENTINEL', value: 91 },
    { userId: STRANGER, dependentId: null, tag: 'OTHER_ACCOUNT_SENTINEL', value: 221 },
  ];
  const visits: Record<string, string> = {};
  for (const person of people) {
    const { userId, dependentId, tag, value } = person;
    const medId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO medications (id,user_id,dependent_id,name,active,created_at,updated_at) VALUES (?,?,?,?,1,?,?)`
      )
      .run(medId, userId, dependentId, `${tag}_MED`, now, now);
    sqlite
      .prepare(
        `INSERT INTO conditions (id,user_id,dependent_id,name,status,created_at,updated_at) VALUES (?,?,?,?,'active',?,?)`
      )
      .run(crypto.randomUUID(), userId, dependentId, `${tag}_CONDITION`, now, now);
    sqlite
      .prepare(
        `INSERT INTO notes (id,user_id,dependent_id,content,recorded_at,created_at) VALUES (?,?,?,?,?,?)`
      )
      .run(crypto.randomUUID(), userId, dependentId, `${tag}_NOTE`, recent, now);
    sqlite
      .prepare(
        `INSERT INTO appointments (id,user_id,dependent_id,reason,appointment_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`
      )
      .run(crypto.randomUUID(), userId, dependentId, `${tag}_APPOINTMENT`, future, now, now);
    const visit = crypto.randomUUID();
    visits[tag] = visit;
    sqlite
      .prepare(
        `INSERT INTO lab_visits (id,user_id,dependent_id,visit_date,created_at) VALUES (?,?,?,?,?)`
      )
      .run(
        visit,
        userId,
        dependentId,
        tag === 'SELF_SENTINEL' ? ownerDate : recent.slice(0, 10),
        now
      );
    sqlite
      .prepare(
        `INSERT INTO lab_results (id,user_id,dependent_id,lab_visit_id,test_name,value,flag,created_at) VALUES (?,?,?,?,?,?,'high',?)`
      )
      .run(crypto.randomUUID(), userId, dependentId, visit, `${tag}_LAB`, value, now);
    sqlite
      .prepare(
        `INSERT INTO vitals (id,user_id,dependent_id,metric_key,value,unit,source,recorded_at,metadata,created_at) VALUES (?,?,?,'weight',?,'lbs','manual',?,'{}',?)`
      )
      .run(crypto.randomUUID(), userId, dependentId, value, recent, now);
    sqlite
      .prepare(
        `INSERT INTO workout_sessions (id,user_id,dependent_id,type,label,started_at,created_at,updated_at) VALUES (?,?,?,'strength',?,?,?,?)`
      )
      .run(crypto.randomUUID(), userId, dependentId, `${tag}_WORKOUT`, recent, now, now);
    sqlite
      .prepare(
        `INSERT INTO interaction_alerts (id,user_id,dependent_id,trigger_medication_id,alert_text,severity,medication_snapshot,checked_at,context_version) VALUES (?,?,?,?,?,'warning','{}',?,1)`
      )
      .run(crypto.randomUUID(), userId, dependentId, medId, `${tag}_ALERT`, now);
    if (dependentId === null) {
      sqlite
        .prepare(`INSERT INTO profiles (id,display_name,created_at,updated_at) VALUES (?,?,?,?)`)
        .run(userId, `${tag}_PROFILE`, now, now);
      sqlite
        .prepare(
          `INSERT INTO goals (id,user_id,kind,metric_key,direction,active,created_at,updated_at) VALUES (?,?,'metric',?,'increase',1,?,?)`
        )
        .run(crypto.randomUUID(), userId, `${tag}_GOAL`, now, now);
    }
  }
  if (includeOwner) {
    // Inconsistent imported rows must not acquire the owner's visit attribution.
    for (const [userId, dependentId, tag] of [
      [OWNER, dependents[0], 'MISMATCH_DEP_SENTINEL'],
      [STRANGER, null, 'MISMATCH_ACCOUNT_SENTINEL'],
    ] as const) {
      sqlite
        .prepare(
          `INSERT INTO lab_results (id,user_id,dependent_id,lab_visit_id,test_name,value,flag,created_at) VALUES (?,?,?,?,?,333,'high',?)`
        )
        .run(crypto.randomUUID(), userId, dependentId, visits.SELF_SENTINEL, tag, now);
    }
    sqlite
      .prepare(
        `INSERT INTO lab_results (id,user_id,dependent_id,lab_visit_id,test_name,value,flag,created_at) VALUES (?,?,NULL,?,?,444,'high',?)`
      )
      .run(crypto.randomUUID(), OWNER, visits.DEP_ONE_SENTINEL, 'MISMATCH_PARENT_SENTINEL', now);
  }
  return { dependents, ownerDate };
}
