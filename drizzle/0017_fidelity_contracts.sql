-- Additive HF storage. No legacy value/date/identity is rewritten or projected.
CREATE TABLE clinical_records (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 dependent_id TEXT REFERENCES dependents(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('lab','medication','medication_event')),
 payload_json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
 source_key TEXT,
 legacy_table TEXT CHECK (legacy_table IN ('lab_results','medications')),
 legacy_id TEXT,
 legacy_revision TEXT,
 received_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_clinical_records_subject ON clinical_records(user_id,dependent_id,kind);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_clinical_record_source ON clinical_records(user_id,coalesce(dependent_id,''),source_key) WHERE source_key IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_clinical_legacy_overlay ON clinical_records(user_id,coalesce(dependent_id,''),legacy_table,legacy_id) WHERE legacy_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE clinical_intake_batches (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 dependent_id TEXT REFERENCES dependents(id) ON DELETE CASCADE,
 external_id TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 payload_json TEXT NOT NULL,
 digest TEXT NOT NULL,
 received_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 approved_at TEXT,
 approved_digest TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_clinical_intake_identity ON clinical_intake_batches(user_id,coalesce(dependent_id,''),external_id);
--> statement-breakpoint
CREATE TABLE clinical_intake_items (
 id TEXT PRIMARY KEY NOT NULL,
 batch_id TEXT NOT NULL REFERENCES clinical_intake_batches(id) ON DELETE CASCADE,
 item_key TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 record_id TEXT,
 outcome_json TEXT,
 UNIQUE(batch_id,item_key)
);
--> statement-breakpoint
CREATE TABLE body_scans (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 dependent_id TEXT REFERENCES dependents(id) ON DELETE CASCADE,
 source TEXT NOT NULL,
 external_id TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 normalized_json TEXT NOT NULL,
 revision TEXT NOT NULL,
 received_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_body_scan_identity ON body_scans(user_id,coalesce(dependent_id,''),source,external_id);
--> statement-breakpoint
CREATE INDEX idx_body_scan_subject ON body_scans(user_id,dependent_id,received_at);
