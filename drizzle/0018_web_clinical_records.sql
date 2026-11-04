-- WC1 widens typed clinical variants only; preserve every existing rowid/value.
CREATE TABLE clinical_records_wc (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 dependent_id TEXT REFERENCES dependents(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('lab','medication','medication_event','encounter','sleep_study','pap_report','screening','procedure','condition','allergy_review','genetic_report')),
 payload_json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
 source_key TEXT,
 legacy_table TEXT CHECK (legacy_table IN ('lab_results','medications','conditions','procedures')),
 legacy_id TEXT,
 legacy_revision TEXT,
 received_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT INTO clinical_records_wc(rowid,id,user_id,dependent_id,kind,payload_json,revision,source_key,legacy_table,legacy_id,legacy_revision,received_at,updated_at) SELECT rowid,id,user_id,dependent_id,kind,payload_json,revision,source_key,legacy_table,legacy_id,legacy_revision,received_at,updated_at FROM clinical_records;
--> statement-breakpoint
DROP TABLE clinical_records;
--> statement-breakpoint
ALTER TABLE clinical_records_wc RENAME TO clinical_records;
--> statement-breakpoint
CREATE INDEX idx_clinical_records_subject ON clinical_records(user_id,dependent_id,kind);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_clinical_record_source ON clinical_records(user_id,coalesce(dependent_id,''),source_key) WHERE source_key IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_clinical_legacy_overlay ON clinical_records(user_id,coalesce(dependent_id,''),legacy_table,legacy_id) WHERE legacy_id IS NOT NULL;
