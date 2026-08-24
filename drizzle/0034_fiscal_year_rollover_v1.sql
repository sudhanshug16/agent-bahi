CREATE TABLE `fiscal_year_rollovers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`financial_year` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`ledger_revision` integer NOT NULL,
	`close_pack_manifest_id` text NOT NULL,
	`close_pack_manifest_hash` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`source` text NOT NULL,
	`reason` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`result_hash` text NOT NULL,
	`finalized_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`book_set_id`) REFERENCES `book_set_ledger_revisions`(`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`close_pack_manifest_id`,`tenant_id`,`book_set_id`) REFERENCES `close_pack_manifests`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `chk_fiscal_year_rollover_year` CHECK(length(`financial_year`) = 9 AND substr(`financial_year`, 5, 1) = '-' AND typeof(CAST(substr(`financial_year`, 1, 4) AS INTEGER)) = 'integer' AND CAST(substr(`financial_year`, 6, 4) AS INTEGER) = CAST(substr(`financial_year`, 1, 4) AS INTEGER) + 1),
	CONSTRAINT `chk_fiscal_year_rollover_dates` CHECK(`period_start` = substr(`financial_year`, 1, 4) || '-04-01' AND `period_end` = substr(`financial_year`, 6, 4) || '-03-31'),
	CONSTRAINT `chk_fiscal_year_rollover_revision` CHECK(typeof(`ledger_revision`) = 'integer' AND `ledger_revision` >= 0),
	CONSTRAINT `chk_fiscal_year_rollover_actor` CHECK(`actor_type` = 'HUMAN' AND length(trim(`actor_id`)) > 0),
	CONSTRAINT `chk_fiscal_year_rollover_hashes` CHECK(length(`close_pack_manifest_hash`) = 64 AND `close_pack_manifest_hash` NOT GLOB '*[^0-9a-f]*' AND length(`snapshot_hash`) = 64 AND `snapshot_hash` NOT GLOB '*[^0-9a-f]*' AND length(`request_hash`) = 64 AND `request_hash` NOT GLOB '*[^0-9a-f]*' AND length(`result_hash`) = 64 AND `result_hash` NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT `chk_fiscal_year_rollover_reason` CHECK(length(trim(`reason`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fiscal_year_rollover_scope_year` ON `fiscal_year_rollovers` (`tenant_id`,`book_set_id`,`financial_year`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fiscal_year_rollover_request` ON `fiscal_year_rollovers` (`tenant_id`,`book_set_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fiscal_year_rollover_id_scope` ON `fiscal_year_rollovers` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_fiscal_year_rollovers_scope` ON `fiscal_year_rollovers` (`tenant_id`,`book_set_id`,`financial_year`,`finalized_at`,`id`);--> statement-breakpoint
CREATE TRIGGER `fiscal_year_rollovers_no_update` BEFORE UPDATE ON `fiscal_year_rollovers` BEGIN SELECT RAISE(ABORT, 'fiscal year rollover snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `fiscal_year_rollovers_no_delete` BEFORE DELETE ON `fiscal_year_rollovers` BEGIN SELECT RAISE(ABORT, 'fiscal year rollover snapshots are immutable'); END;
