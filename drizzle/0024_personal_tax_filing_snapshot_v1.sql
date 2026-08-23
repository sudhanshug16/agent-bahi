CREATE TABLE `filing_snapshot_book_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`membership_version_id` text NOT NULL,
	`membership_version` integer NOT NULL,
	`book_set_id` text NOT NULL,
	`book_set_kind` text NOT NULL,
	`ledger_revision` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`,`tenant_id`,`tax_case_id`) REFERENCES `filing_snapshots`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`membership_version_id`,`tax_case_id`,`tenant_id`) REFERENCES `tax_case_membership_versions`(`id`,`tax_case_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_filing_snapshot_book_set_version" CHECK(typeof("filing_snapshot_book_sets"."membership_version") = 'integer' AND "filing_snapshot_book_sets"."membership_version" >= 1),
	CONSTRAINT "chk_filing_snapshot_book_set_revision" CHECK(typeof("filing_snapshot_book_sets"."ledger_revision") = 'integer' AND "filing_snapshot_book_sets"."ledger_revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_filing_snapshot_book_sets_member` ON `filing_snapshot_book_sets` (`snapshot_id`,`tenant_id`,`tax_case_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_filing_snapshot_book_sets_snapshot` ON `filing_snapshot_book_sets` (`tenant_id`,`tax_case_id`,`snapshot_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `filing_snapshot_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`source_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`normalized_payload_hash` text NOT NULL,
	`lifecycle` text NOT NULL,
	`terminal_event_id` text NOT NULL,
	`terminal_event_type` text NOT NULL,
	`terminal_event_hash` text NOT NULL,
	`gross_amount_minor` integer NOT NULL,
	`allocated_amount_minor` integer NOT NULL,
	`reconciliation_status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`,`tenant_id`,`tax_case_id`) REFERENCES `filing_snapshots`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fact_id`,`tenant_id`,`tax_case_id`) REFERENCES `tax_case_facts`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_filing_snapshot_fact_lifecycle" CHECK("filing_snapshot_facts"."lifecycle" IN ('PROPOSED', 'HUMAN_CONFIRMED', 'REJECTED')),
	CONSTRAINT "chk_filing_snapshot_fact_terminal" CHECK("filing_snapshot_facts"."terminal_event_type" IN ('PROPOSED', 'HUMAN_CONFIRMED', 'REJECTED') AND length("filing_snapshot_facts"."terminal_event_hash") = 64 AND "filing_snapshot_facts"."terminal_event_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_filing_snapshot_fact_amounts" CHECK(typeof("filing_snapshot_facts"."gross_amount_minor") = 'integer' AND "filing_snapshot_facts"."gross_amount_minor" >= 0 AND typeof("filing_snapshot_facts"."allocated_amount_minor") = 'integer' AND "filing_snapshot_facts"."allocated_amount_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_filing_snapshot_facts_fact` ON `filing_snapshot_facts` (`snapshot_id`,`tenant_id`,`tax_case_id`,`fact_id`);--> statement-breakpoint
CREATE INDEX `idx_filing_snapshot_facts_snapshot` ON `filing_snapshot_facts` (`tenant_id`,`tax_case_id`,`snapshot_id`,`fact_id`);--> statement-breakpoint
CREATE TABLE `filing_snapshot_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`reconciliation_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`journal_line_id` text NOT NULL,
	`allocated_amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`,`tenant_id`,`tax_case_id`) REFERENCES `filing_snapshots`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reconciliation_id`,`tenant_id`,`tax_case_id`) REFERENCES `tax_case_fact_reconciliations`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fact_id`,`tenant_id`,`tax_case_id`) REFERENCES `tax_case_facts`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_filing_snapshot_reconciliation_amount" CHECK(typeof("filing_snapshot_reconciliations"."allocated_amount_minor") = 'integer' AND "filing_snapshot_reconciliations"."allocated_amount_minor" > 0),
	CONSTRAINT "chk_filing_snapshot_reconciliation_currency" CHECK(length("filing_snapshot_reconciliations"."currency") = 3 AND "filing_snapshot_reconciliations"."currency" = upper("filing_snapshot_reconciliations"."currency")),
	CONSTRAINT "chk_filing_snapshot_reconciliation_hash" CHECK(length("filing_snapshot_reconciliations"."request_hash") = 64 AND "filing_snapshot_reconciliations"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_filing_snapshot_reconciliations_row` ON `filing_snapshot_reconciliations` (`snapshot_id`,`tenant_id`,`tax_case_id`,`reconciliation_id`);--> statement-breakpoint
CREATE INDEX `idx_filing_snapshot_reconciliations_snapshot` ON `filing_snapshot_reconciliations` (`tenant_id`,`tax_case_id`,`snapshot_id`,`fact_id`);--> statement-breakpoint
CREATE TABLE `filing_snapshot_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`source_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_status` text NOT NULL,
	`parser_status` text NOT NULL,
	`parser_identity` text NOT NULL,
	`parser_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`,`tenant_id`,`tax_case_id`) REFERENCES `filing_snapshots`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`,`tax_case_id`,`tenant_id`) REFERENCES `tax_case_external_sources`(`id`,`tax_case_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`,`tenant_id`) REFERENCES `personal_tax_source_artifacts`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_filing_snapshot_source_hash" CHECK(length("filing_snapshot_sources"."content_hash") = 64 AND "filing_snapshot_sources"."content_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_filing_snapshot_sources_source` ON `filing_snapshot_sources` (`snapshot_id`,`tenant_id`,`tax_case_id`,`source_id`,`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_filing_snapshot_sources_snapshot` ON `filing_snapshot_sources` (`tenant_id`,`tax_case_id`,`snapshot_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `filing_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`membership_version_id` text NOT NULL,
	`membership_version` integer NOT NULL,
	`membership_hash` text NOT NULL,
	`pan_profile_id` text NOT NULL,
	`pan_profile_version` text NOT NULL,
	`pan_lookup_hash` text NOT NULL,
	`pan_last_four` text NOT NULL,
	`pan_masked_display` text NOT NULL,
	`candidate_hash` text NOT NULL,
	`candidate_json` text NOT NULL,
	`creation_metadata_json` text NOT NULL,
	`seal_request_id` text NOT NULL,
	`seal_request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_case_id`,`tenant_id`) REFERENCES `tax_cases`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`membership_version_id`,`tax_case_id`,`tenant_id`) REFERENCES `tax_case_membership_versions`(`id`,`tax_case_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pan_profile_id`,`tenant_id`) REFERENCES `tenant_pan_profiles`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_filing_snapshot_membership_version" CHECK(typeof("filing_snapshots"."membership_version") = 'integer' AND "filing_snapshots"."membership_version" >= 1),
	CONSTRAINT "chk_filing_snapshot_hashes" CHECK(length("filing_snapshots"."membership_hash") = 64 AND "filing_snapshots"."membership_hash" NOT GLOB '*[^0-9a-f]*' AND length("filing_snapshots"."pan_lookup_hash") = 64 AND "filing_snapshots"."pan_lookup_hash" NOT GLOB '*[^0-9a-f]*' AND length("filing_snapshots"."candidate_hash") = 64 AND "filing_snapshots"."candidate_hash" NOT GLOB '*[^0-9a-f]*' AND length("filing_snapshots"."seal_request_hash") = 64 AND "filing_snapshots"."seal_request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_filing_snapshot_pan_masked" CHECK("filing_snapshots"."pan_masked_display" = '******' || "filing_snapshots"."pan_last_four")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_filing_snapshots_id_scope` ON `filing_snapshots` (`id`,`tenant_id`,`tax_case_id`);--> statement-breakpoint
CREATE INDEX `idx_filing_snapshots_case` ON `filing_snapshots` (`tenant_id`,`tax_case_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_fact_reconciliations_id_scope` ON `tax_case_fact_reconciliations` (`id`,`tenant_id`,`tax_case_id`);--> statement-breakpoint
CREATE TRIGGER `filing_snapshots_no_update` BEFORE UPDATE ON `filing_snapshots` BEGIN SELECT RAISE(ABORT, 'filing snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `filing_snapshots_no_delete` BEFORE DELETE ON `filing_snapshots` BEGIN SELECT RAISE(ABORT, 'filing snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `filing_snapshot_book_sets_no_update` BEFORE UPDATE ON `filing_snapshot_book_sets` BEGIN SELECT RAISE(ABORT, 'filing snapshot book set bindings are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `filing_snapshot_book_sets_no_delete` BEFORE DELETE ON `filing_snapshot_book_sets` BEGIN SELECT RAISE(ABORT, 'filing snapshot book set bindings are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `filing_snapshot_sources_no_update` BEFORE UPDATE ON `filing_snapshot_sources` BEGIN SELECT RAISE(ABORT, 'filing snapshot source bindings are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `filing_snapshot_sources_no_delete` BEFORE DELETE ON `filing_snapshot_sources` BEGIN SELECT RAISE(ABORT, 'filing snapshot source bindings are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `filing_snapshot_facts_no_update` BEFORE UPDATE ON `filing_snapshot_facts` BEGIN SELECT RAISE(ABORT, 'filing snapshot fact bindings are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `filing_snapshot_facts_no_delete` BEFORE DELETE ON `filing_snapshot_facts` BEGIN SELECT RAISE(ABORT, 'filing snapshot fact bindings are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `filing_snapshot_reconciliations_no_update` BEFORE UPDATE ON `filing_snapshot_reconciliations` BEGIN SELECT RAISE(ABORT, 'filing snapshot reconciliation bindings are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `filing_snapshot_reconciliations_no_delete` BEFORE DELETE ON `filing_snapshot_reconciliations` BEGIN SELECT RAISE(ABORT, 'filing snapshot reconciliation bindings are immutable'); END;
