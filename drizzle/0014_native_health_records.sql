ALTER TABLE vitals ADD COLUMN native_record_id text;
--> statement-breakpoint
DROP INDEX idx_vitals_upsert_tuple;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_vitals_upsert_tuple ON vitals(user_id,metric_key,recorded_at,source,coalesce(dependent_id,'')) WHERE native_record_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_vitals_native_identity ON vitals(user_id,metric_key,source,native_record_id) WHERE native_record_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE health_connect_native_state (
 device_id text PRIMARY KEY REFERENCES mobile_devices(id) ON DELETE CASCADE,
 generation text NOT NULL, last_sequence integer NOT NULL DEFAULT 0,
 last_read_at text, last_received_at text
);
--> statement-breakpoint
CREATE TABLE health_connect_native_batches (
 device_id text NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
 generation text NOT NULL, batch_id text NOT NULL, sequence integer NOT NULL,
 body_sha256 text NOT NULL, result_json text NOT NULL, received_at text NOT NULL,
 PRIMARY KEY(device_id,generation,batch_id), UNIQUE(device_id,generation,sequence)
);
--> statement-breakpoint
CREATE TABLE health_connect_native_records (
 user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 record_type text NOT NULL, source_package text NOT NULL, source_uuid text NOT NULL,
 device_id text NOT NULL, generation text NOT NULL, sequence integer NOT NULL,
 source_modified_at text, deleted_at text,
 PRIMARY KEY(user_id,record_type,source_package,source_uuid)
);
--> statement-breakpoint
CREATE INDEX idx_health_connect_native_uuid ON health_connect_native_records(user_id,source_uuid);
--> statement-breakpoint
CREATE INDEX idx_health_connect_raw_uuid ON health_connect_raw_records(user_id,source_uuid);
--> statement-breakpoint
CREATE INDEX idx_vitals_native_day ON vitals(user_id,source,json_extract(metadata,'$.calendar_day')) WHERE native_record_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE health_connect_native_deletions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 record_type text NOT NULL, source_package text NOT NULL, source_uuid text NOT NULL,
 device_id text NOT NULL, generation text NOT NULL, sequence integer NOT NULL,
 reason text NOT NULL, deleted_at text NOT NULL
);
--> statement-breakpoint
CREATE TABLE health_connect_native_rescans (
 scan_id text PRIMARY KEY, device_id text NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
 generation text NOT NULL, user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 record_type text NOT NULL, packages_json text NOT NULL, start_at text NOT NULL,end_at text NOT NULL,
 begin_sequence integer NOT NULL, next_page integer NOT NULL DEFAULT 0, completed_at text
);
--> statement-breakpoint
CREATE TABLE health_connect_native_scan_seen (
 scan_id text NOT NULL REFERENCES health_connect_native_rescans(scan_id) ON DELETE CASCADE,
 source_package text NOT NULL, source_uuid text NOT NULL,
 PRIMARY KEY(scan_id,source_package,source_uuid)
);
