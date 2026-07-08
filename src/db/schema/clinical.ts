/**
 * Clinical-domain tables: providers, medications, conditions, allergies,
 * procedures, vaccines, lab_visits, lab_results, appointments, notes.
 * Sources: 001_initial_schema.sql, 004_dependents.sql,
 * 005_medical_terminology.sql, 008_vaccines_table_and_rls.sql.
 */
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { dependents } from './users';
import { uuidPk, timestampNow } from './_shared';

// 001 + 004 (dependent_id) + 005 (specialty_taxonomy)
export const providers = sqliteTable(
  'providers',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    providerType: text('provider_type', {
      enum: [
        'pcp',
        'specialist',
        'lab',
        'imaging',
        'urgent_care',
        'hospital',
        'pharmacy',
        'therapist',
        'dentist',
        'other',
      ],
    }),
    specialty: text('specialty'),
    organization: text('organization'),
    phone: text('phone'),
    fax: text('fax'),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    zip: text('zip'),
    portalUrl: text('portal_url'),
    notes: text('notes'),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    specialtyTaxonomy: text('specialty_taxonomy'),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [index('idx_providers_user').on(t.userId, sql`${t.isFavorite} desc`, t.name)],
);

// 001 + 004 + 005 (rxcui)
export const medications = sqliteTable(
  'medications',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    dosage: text('dosage'),
    frequency: text('frequency'),
    category: text('category'),
    prescriberId: text('prescriber_id').references(() => providers.id, { onDelete: 'set null' }),
    startDate: text('start_date'),
    endDate: text('end_date'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    notes: text('notes'),
    rxcui: text('rxcui'),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    index('idx_medications_user_active').on(t.userId, t.active),
    index('idx_medications_dependent').on(t.dependentId),
    index('idx_medications_rxcui').on(t.rxcui),
  ],
);

// 001 + 004 + 005 (icd10_code)
export const conditions = sqliteTable(
  'conditions',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'resolved', 'managed', 'monitoring'] })
      .notNull()
      .default('active'),
    diagnosedDate: text('diagnosed_date'),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    notes: text('notes'),
    icd10Code: text('icd10_code'),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    index('idx_conditions_user_status').on(t.userId, t.status),
    index('idx_conditions_dependent').on(t.dependentId),
    index('idx_conditions_icd10').on(t.icd10Code),
  ],
);

// 005
export const allergies = sqliteTable(
  'allergies',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rxcui: text('rxcui'),
    severity: text('severity', {
      enum: ['mild', 'moderate', 'severe', 'life_threatening'],
    }).notNull(),
    reaction: text('reaction'),
    diagnosedDate: text('diagnosed_date'),
    notes: text('notes'),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    index('idx_allergies_user').on(t.userId),
    index('idx_allergies_rxcui').on(t.rxcui),
  ],
);

// 005
export const procedures = sqliteTable(
  'procedures',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    cptCode: text('cpt_code'),
    procedureDate: text('procedure_date').notNull(),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    notes: text('notes'),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [index('idx_procedures_user_date').on(t.userId, sql`${t.procedureDate} desc`)],
);

// 008
export const vaccines = sqliteTable(
  'vaccines',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    cvxCode: text('cvx_code'),
    vaccineDate: text('vaccine_date').notNull(),
    doseNumber: text('dose_number'),
    seriesDoses: text('series_doses'),
    manufacturer: text('manufacturer'),
    lotNumber: text('lot_number'),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    nextDoseDate: text('next_dose_date'),
    notes: text('notes'),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    index('idx_vaccines_user_date').on(t.userId, sql`${t.vaccineDate} desc`),
    index('idx_vaccines_cvx').on(t.cvxCode),
  ],
);

// 001 + 004
export const labVisits = sqliteTable(
  'lab_visits',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    visitDate: text('visit_date').notNull(),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    sourcePdfPath: text('source_pdf_path'),
    notes: text('notes'),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_lab_visits_user_date').on(t.userId, sql`${t.visitDate} desc`),
    index('idx_lab_visits_dependent').on(t.dependentId),
  ],
);

// 001 + 004 + 005 (loinc_code)
export const labResults = sqliteTable(
  'lab_results',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    labVisitId: text('lab_visit_id')
      .notNull()
      .references(() => labVisits.id, { onDelete: 'cascade' }),
    panelName: text('panel_name'),
    testName: text('test_name').notNull(),
    value: real('value').notNull(),
    unit: text('unit'),
    referenceRangeLow: real('reference_range_low'),
    referenceRangeHigh: real('reference_range_high'),
    referenceRangeText: text('reference_range_text'),
    flag: text('flag', { enum: ['normal', 'high', 'low', 'critical'] }),
    loincCode: text('loinc_code'),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_lab_results_user_test').on(t.userId, t.testName),
    index('idx_lab_results_loinc').on(t.loincCode),
  ],
);

// 001 + 004
export const appointments = sqliteTable(
  'appointments',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    appointmentDate: text('appointment_date').notNull(),
    reason: text('reason'),
    notes: text('notes'),
    followUpDate: text('follow_up_date'),
    labVisitId: text('lab_visit_id').references(() => labVisits.id, { onDelete: 'set null' }),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [index('idx_appointments_user_date').on(t.userId, sql`${t.appointmentDate} desc`)],
);

// 001 + 004
export const notes = sqliteTable(
  'notes',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    noteType: text('note_type', { enum: ['symptom', 'observation', 'general'] })
      .notNull()
      .default('general'),
    // check (severity between 1 and 5) — enforced by zod at the repository boundary
    severity: integer('severity'),
    // text[] not null default '{}'
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    recordedAt: timestampNow('recorded_at'),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('idx_notes_user_date').on(t.userId, sql`${t.recordedAt} desc`)],
);
