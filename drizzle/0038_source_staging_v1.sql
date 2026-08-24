CREATE TABLE `source_staging_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_locator` text NOT NULL,
	`parser_id` text NOT NULL,
	`parser_version` text NOT NULL,
	`schema_fingerprint` text NOT NULL,
	`header_fingerprint` text NOT NULL,
	`source_period_start` text,
	`source_period_end` text,
	`outcome` text NOT NULL,
	`report_json` text NOT NULL,
	`report_hash` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`,`tenant_id`,`book_set_id`) REFERENCES `source_registrations`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `chk_source_staging_batch_outcome` CHECK(`outcome` IN ('STAGED','UNSUPPORTED','REJECTED')),
	CONSTRAINT `chk_source_staging_batch_hashes` CHECK(length(`schema_fingerprint`) = 64 AND `schema_fingerprint` NOT GLOB '*[^0-9a-f]*' AND length(`header_fingerprint`) = 64 AND `header_fingerprint` NOT GLOB '*[^0-9a-f]*' AND length(`report_hash`) = 64 AND `report_hash` NOT GLOB '*[^0-9a-f]*' AND length(`request_hash`) = 64 AND `request_hash` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `source_staging_files` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_locator` text NOT NULL,
	`content_hash` text NOT NULL,
	`parser_id` text NOT NULL,
	`parser_version` text NOT NULL,
	`page_count` integer NOT NULL,
	FOREIGN KEY (`batch_id`,`tenant_id`,`book_set_id`) REFERENCES `source_staging_batches`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`,`tenant_id`,`book_set_id`) REFERENCES `source_registrations`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `chk_source_staging_file_hash` CHECK(length(`content_hash`) = 64 AND `content_hash` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `chk_source_staging_file_pages` CHECK(typeof(`page_count`) = 'integer' AND `page_count` >= 0)
);
--> statement-breakpoint
CREATE TABLE `source_staging_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`file_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`source_id` text NOT NULL,
	`row_number` integer,
	`page_number` integer,
	`outcome` text NOT NULL,
	`reason` text NOT NULL,
	`provenance_json` text NOT NULL,
	`row_hash` text NOT NULL,
	FOREIGN KEY (`batch_id`,`tenant_id`,`book_set_id`) REFERENCES `source_staging_batches`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`,`tenant_id`,`book_set_id`) REFERENCES `source_staging_files`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`,`tenant_id`,`book_set_id`) REFERENCES `source_registrations`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `chk_source_staging_row_outcome` CHECK(`outcome` IN ('STAGED','UNSUPPORTED','REJECTED')),
	CONSTRAINT `chk_source_staging_row_position_values` CHECK((`row_number` IS NULL OR (`row_number` >= 1 AND typeof(`row_number`) = 'integer')) AND (`page_number` IS NULL OR (`page_number` >= 1 AND typeof(`page_number`) = 'integer'))),
	CONSTRAINT `chk_source_staging_row_hash` CHECK(length(`row_hash`) = 64 AND `row_hash` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `source_staging_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`row_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`source_id` text NOT NULL,
	`fact_type` text NOT NULL,
	`fact_json` text NOT NULL,
	`fact_hash` text NOT NULL,
	FOREIGN KEY (`row_id`,`tenant_id`,`book_set_id`) REFERENCES `source_staging_rows`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`,`tenant_id`,`book_set_id`) REFERENCES `source_staging_batches`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`,`tenant_id`,`book_set_id`) REFERENCES `source_registrations`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `chk_source_staging_fact_hash` CHECK(length(`fact_hash`) = 64 AND `fact_hash` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_staging_source_parser` ON `source_staging_batches` (`tenant_id`,`book_set_id`,`source_id`,`parser_id`,`parser_version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_staging_batches_scope_id` ON `source_staging_batches` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_staging_request` ON `source_staging_batches` (`tenant_id`,`request_id`);
--> statement-breakpoint
CREATE INDEX `idx_source_staging_batches_scope` ON `source_staging_batches` (`tenant_id`,`book_set_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_staging_file` ON `source_staging_files` (`batch_id`,`source_id`,`content_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_staging_files_scope_id` ON `source_staging_files` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_source_staging_files_scope` ON `source_staging_files` (`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_staging_row_position` ON `source_staging_rows` (`batch_id`,`source_id`,`row_number`,`page_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_staging_rows_scope_id` ON `source_staging_rows` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_source_staging_rows_scope` ON `source_staging_rows` (`tenant_id`,`book_set_id`,`batch_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_staging_fact` ON `source_staging_facts` (`row_id`,`fact_type`);
--> statement-breakpoint
CREATE INDEX `idx_source_staging_facts_scope` ON `source_staging_facts` (`tenant_id`,`book_set_id`,`batch_id`);
--> statement-breakpoint
CREATE TRIGGER `source_staging_batches_no_update` BEFORE UPDATE ON `source_staging_batches` BEGIN SELECT RAISE(ABORT, 'source staging batches are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_staging_batches_no_delete` BEFORE DELETE ON `source_staging_batches` BEGIN SELECT RAISE(ABORT, 'source staging batches are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_staging_files_no_update` BEFORE UPDATE ON `source_staging_files` BEGIN SELECT RAISE(ABORT, 'source staging files are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_staging_files_no_delete` BEFORE DELETE ON `source_staging_files` BEGIN SELECT RAISE(ABORT, 'source staging files are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_staging_rows_no_update` BEFORE UPDATE ON `source_staging_rows` BEGIN SELECT RAISE(ABORT, 'source staging rows are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_staging_rows_no_delete` BEFORE DELETE ON `source_staging_rows` BEGIN SELECT RAISE(ABORT, 'source staging rows are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_staging_facts_no_update` BEFORE UPDATE ON `source_staging_facts` BEGIN SELECT RAISE(ABORT, 'source staging facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_staging_facts_no_delete` BEFORE DELETE ON `source_staging_facts` BEGIN SELECT RAISE(ABORT, 'source staging facts are immutable'); END;
