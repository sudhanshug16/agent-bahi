CREATE TABLE `zoho_backup_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_path` text NOT NULL,
	`archive_hash` text NOT NULL,
	`source_kind` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`entity_fingerprint` text,
	`status` text NOT NULL,
	`report_hash` text NOT NULL,
	`report_json` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`confirmed_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `chk_zoho_backup_import_status` CHECK(`status` IN ('PREVIEWED','STAGED','PARTIAL','REJECTED')),
	CONSTRAINT `chk_zoho_backup_import_hashes` CHECK(length(`archive_hash`) = 64 AND `archive_hash` NOT GLOB '*[^0-9a-f]*' AND length(`report_hash`) = 64 AND `report_hash` NOT GLOB '*[^0-9a-f]*' AND length(`request_hash`) = 64 AND `request_hash` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `zoho_backup_import_files` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`path` text NOT NULL,
	`content_hash` text NOT NULL,
	`schema_fingerprint` text NOT NULL,
	`header_fingerprint` text NOT NULL,
	`headers_json` text NOT NULL,
	`row_count` integer NOT NULL,
	`object_type` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `zoho_backup_imports`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `chk_zoho_backup_import_file_hashes` CHECK(length(`content_hash`) = 64 AND `content_hash` NOT GLOB '*[^0-9a-f]*' AND length(`schema_fingerprint`) = 64 AND `schema_fingerprint` NOT GLOB '*[^0-9a-f]*' AND length(`header_fingerprint`) = 64 AND `header_fingerprint` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `chk_zoho_backup_import_file_rows` CHECK(typeof(`row_count`) = 'integer' AND `row_count` >= 0),
	CONSTRAINT `chk_zoho_backup_import_file_status` CHECK(`status` IN ('SUPPORTED','UNSUPPORTED','REJECTED'))
);
--> statement-breakpoint
CREATE TABLE `zoho_backup_import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`file_path` text NOT NULL,
	`row_number` integer NOT NULL,
	`object_type` text NOT NULL,
	`external_id` text,
	`outcome` text NOT NULL,
	`reason` text NOT NULL,
	`source_row_json` text NOT NULL,
	`source_row_hash` text NOT NULL,
	`canonical_id` text,
	FOREIGN KEY (`import_id`) REFERENCES `zoho_backup_imports`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `chk_zoho_backup_import_row_outcome` CHECK(`outcome` IN ('ACCEPTED','REJECTED','UNSUPPORTED','STAGED')),
	CONSTRAINT `chk_zoho_backup_import_row_hash` CHECK(length(`source_row_hash`) = 64 AND `source_row_hash` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `chk_zoho_backup_import_row_number` CHECK(typeof(`row_number`) = 'integer' AND `row_number` >= 2)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_zoho_backup_import_source` ON `zoho_backup_imports` (`tenant_id`,`book_set_id`,`archive_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_zoho_backup_import_request` ON `zoho_backup_imports` (`tenant_id`,`request_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_zoho_backup_import_file_path` ON `zoho_backup_import_files` (`import_id`,`path`);
--> statement-breakpoint
CREATE INDEX `idx_zoho_backup_import_rows` ON `zoho_backup_import_rows` (`import_id`,`file_path`,`row_number`);
--> statement-breakpoint
CREATE TRIGGER `zoho_backup_imports_no_update` BEFORE UPDATE ON `zoho_backup_imports` WHEN OLD.status != 'PREVIEWED' BEGIN SELECT RAISE(ABORT, 'zoho backup imports are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `zoho_backup_imports_no_delete` BEFORE DELETE ON `zoho_backup_imports` BEGIN SELECT RAISE(ABORT, 'zoho backup imports are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `zoho_backup_import_files_no_update` BEFORE UPDATE ON `zoho_backup_import_files` BEGIN SELECT RAISE(ABORT, 'zoho backup import files are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `zoho_backup_import_files_no_delete` BEFORE DELETE ON `zoho_backup_import_files` BEGIN SELECT RAISE(ABORT, 'zoho backup import files are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `zoho_backup_import_rows_no_update` BEFORE UPDATE ON `zoho_backup_import_rows` BEGIN SELECT RAISE(ABORT, 'zoho backup import rows are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `zoho_backup_import_rows_no_delete` BEFORE DELETE ON `zoho_backup_import_rows` BEGIN SELECT RAISE(ABORT, 'zoho backup import rows are immutable'); END;
