CREATE TABLE `personal_tax_position_worksheets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`filing_snapshot_id` text NOT NULL,
	`snapshot_candidate_hash` text NOT NULL,
	`input_bindings_json` text NOT NULL,
	`input_hash` text NOT NULL,
	`output_json` text NOT NULL,
	`output_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filing_snapshot_id`,`tenant_id`,`tax_case_id`) REFERENCES `filing_snapshots`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_position_worksheets_hashes" CHECK(length("personal_tax_position_worksheets"."snapshot_candidate_hash") = 64 AND "personal_tax_position_worksheets"."snapshot_candidate_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_position_worksheets"."input_hash") = 64 AND "personal_tax_position_worksheets"."input_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_position_worksheets"."output_hash") = 64 AND "personal_tax_position_worksheets"."output_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_personal_tax_position_worksheets_id_scope` ON `personal_tax_position_worksheets` (`id`,`tenant_id`,`tax_case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_personal_tax_position_worksheets_input` ON `personal_tax_position_worksheets` (`tenant_id`,`tax_case_id`,`filing_snapshot_id`,`input_hash`);--> statement-breakpoint
CREATE INDEX `idx_personal_tax_position_worksheets_case` ON `personal_tax_position_worksheets` (`tenant_id`,`tax_case_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TRIGGER `personal_tax_position_worksheets_no_update` BEFORE UPDATE ON `personal_tax_position_worksheets` BEGIN SELECT RAISE(ABORT, 'personal tax position worksheets are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `personal_tax_position_worksheets_no_delete` BEFORE DELETE ON `personal_tax_position_worksheets` BEGIN SELECT RAISE(ABORT, 'personal tax position worksheets are immutable'); END;
