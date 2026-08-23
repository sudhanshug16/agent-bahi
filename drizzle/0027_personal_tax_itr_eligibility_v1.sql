CREATE TABLE IF NOT EXISTS `personal_tax_authority_pack_events` (
	`id` text PRIMARY KEY NOT NULL,
	`pack_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`expected_pack_hash` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pack_id`) REFERENCES `personal_tax_authority_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_authority_pack_event_type" CHECK("personal_tax_authority_pack_events"."event_type" IN ('REGISTERED', 'HUMAN_VERIFIED', 'REJECTED', 'SUPERSEDED')),
	CONSTRAINT "chk_personal_tax_authority_pack_event_actor" CHECK("personal_tax_authority_pack_events"."actor_kind" IN ('AGENT', 'HUMAN') AND length(trim("personal_tax_authority_pack_events"."actor_id")) > 0 AND ("personal_tax_authority_pack_events"."event_type" IN ('REGISTERED', 'SUPERSEDED') OR "personal_tax_authority_pack_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_personal_tax_authority_pack_event_hashes" CHECK(length("personal_tax_authority_pack_events"."expected_pack_hash") = 64 AND "personal_tax_authority_pack_events"."expected_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_authority_pack_events"."request_hash") = 64 AND "personal_tax_authority_pack_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_authority_pack_events_request` ON `personal_tax_authority_pack_events` (`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_authority_pack_events_pack` ON `personal_tax_authority_pack_events` (`pack_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personal_tax_authority_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`jurisdiction` text NOT NULL,
	`authority` text NOT NULL,
	`financial_year` text NOT NULL,
	`assessment_year` text NOT NULL,
	`filing_types_json` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`released_at` text NOT NULL,
	`release_identifier` text NOT NULL,
	`artifact_references_json` text NOT NULL,
	`pack_version` text NOT NULL,
	`candidate_forms_json` text NOT NULL,
	`rule_ast_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`lifecycle` text DEFAULT 'PROPOSED' NOT NULL,
	`supersedes_pack_id` text,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`supersedes_pack_id`) REFERENCES `personal_tax_authority_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_authority_packs_scope" CHECK("personal_tax_authority_packs"."jurisdiction" = 'IN' AND "personal_tax_authority_packs"."authority" = 'INCOME_TAX'),
	CONSTRAINT "chk_personal_tax_authority_packs_lifecycle" CHECK("personal_tax_authority_packs"."lifecycle" IN ('PROPOSED', 'HUMAN_VERIFIED', 'REJECTED')),
	CONSTRAINT "chk_personal_tax_authority_packs_actor" CHECK("personal_tax_authority_packs"."created_by_actor_kind" IN ('AGENT', 'HUMAN') AND length(trim("personal_tax_authority_packs"."created_by_actor_id")) > 0),
	CONSTRAINT "chk_personal_tax_authority_packs_hash" CHECK(length("personal_tax_authority_packs"."canonical_hash") = 64 AND "personal_tax_authority_packs"."canonical_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_authority_packs_hash` ON `personal_tax_authority_packs` (`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_authority_packs_identity` ON `personal_tax_authority_packs` (`jurisdiction`,`authority`,`financial_year`,`assessment_year`,`pack_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_authority_packs_applicable` ON `personal_tax_authority_packs` (`jurisdiction`,`authority`,`financial_year`,`assessment_year`,`lifecycle`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tax_case_itr_eligibility_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`pack_id` text NOT NULL,
	`pack_hash` text NOT NULL,
	`filing_snapshot_id` text NOT NULL,
	`snapshot_candidate_hash` text NOT NULL,
	`worksheet_id` text NOT NULL,
	`worksheet_output_hash` text NOT NULL,
	`fact_set_hash` text NOT NULL,
	`results_json` text NOT NULL,
	`evaluation_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_case_id`,`tenant_id`) REFERENCES `tax_cases`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pack_id`) REFERENCES `personal_tax_authority_packs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filing_snapshot_id`,`tenant_id`,`tax_case_id`) REFERENCES `filing_snapshots`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`worksheet_id`,`tenant_id`,`tax_case_id`) REFERENCES `personal_tax_position_worksheets`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_itr_eligibility_evaluation_hashes" CHECK(length("tax_case_itr_eligibility_evaluations"."pack_hash") = 64 AND "tax_case_itr_eligibility_evaluations"."pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_itr_eligibility_evaluations"."snapshot_candidate_hash") = 64 AND "tax_case_itr_eligibility_evaluations"."snapshot_candidate_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_itr_eligibility_evaluations"."worksheet_output_hash") = 64 AND "tax_case_itr_eligibility_evaluations"."worksheet_output_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_itr_eligibility_evaluations"."fact_set_hash") = 64 AND "tax_case_itr_eligibility_evaluations"."fact_set_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_itr_eligibility_evaluations"."evaluation_hash") = 64 AND "tax_case_itr_eligibility_evaluations"."evaluation_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_tax_case_itr_eligibility_evaluation_actor" CHECK("tax_case_itr_eligibility_evaluations"."created_by_actor_kind" IN ('AGENT', 'HUMAN') AND length(trim("tax_case_itr_eligibility_evaluations"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tax_case_itr_eligibility_evaluations_case` ON `tax_case_itr_eligibility_evaluations` (`tenant_id`,`tax_case_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tax_case_itr_eligibility_fact_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`fact_id`,`tenant_id`,`tax_case_id`) REFERENCES `tax_case_itr_eligibility_facts`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_itr_eligibility_fact_event_type" CHECK("tax_case_itr_eligibility_fact_events"."event_type" IN ('PROPOSED', 'HUMAN_CONFIRMED', 'REJECTED')),
	CONSTRAINT "chk_tax_case_itr_eligibility_fact_event_actor" CHECK("tax_case_itr_eligibility_fact_events"."actor_kind" IN ('AGENT', 'HUMAN') AND length(trim("tax_case_itr_eligibility_fact_events"."actor_id")) > 0 AND ("tax_case_itr_eligibility_fact_events"."event_type" = 'PROPOSED' OR "tax_case_itr_eligibility_fact_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_tax_case_itr_eligibility_fact_event_hash" CHECK(length("tax_case_itr_eligibility_fact_events"."request_hash") = 64 AND "tax_case_itr_eligibility_fact_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_tax_case_itr_eligibility_fact_events_request` ON `tax_case_itr_eligibility_fact_events` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tax_case_itr_eligibility_fact_events_fact` ON `tax_case_itr_eligibility_fact_events` (`tenant_id`,`tax_case_id`,`fact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tax_case_itr_eligibility_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`filing_snapshot_id` text NOT NULL,
	`snapshot_candidate_hash` text NOT NULL,
	`worksheet_id` text NOT NULL,
	`worksheet_output_hash` text NOT NULL,
	`field_name` text NOT NULL,
	`value_type` text NOT NULL,
	`value_json` text NOT NULL,
	`provenance_kind` text NOT NULL,
	`provenance_json` text NOT NULL,
	`verification_state` text DEFAULT 'UNVERIFIED' NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_case_id`,`tenant_id`) REFERENCES `tax_cases`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filing_snapshot_id`,`tenant_id`,`tax_case_id`) REFERENCES `filing_snapshots`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`worksheet_id`,`tenant_id`,`tax_case_id`) REFERENCES `personal_tax_position_worksheets`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_itr_eligibility_fact_hashes" CHECK(length("tax_case_itr_eligibility_facts"."snapshot_candidate_hash") = 64 AND "tax_case_itr_eligibility_facts"."snapshot_candidate_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_itr_eligibility_facts"."worksheet_output_hash") = 64 AND "tax_case_itr_eligibility_facts"."worksheet_output_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_tax_case_itr_eligibility_fact_type" CHECK("tax_case_itr_eligibility_facts"."value_type" IN ('BOOLEAN', 'STRING', 'INTEGER_MINOR')),
	CONSTRAINT "chk_tax_case_itr_eligibility_fact_provenance" CHECK("tax_case_itr_eligibility_facts"."provenance_kind" IN ('WORKSHEET_DERIVED', 'HUMAN_ASSERTION', 'AGENT_ASSERTION') AND "tax_case_itr_eligibility_facts"."verification_state" IN ('UNVERIFIED', 'HUMAN_VERIFIED')),
	CONSTRAINT "chk_tax_case_itr_eligibility_fact_actor" CHECK("tax_case_itr_eligibility_facts"."created_by_actor_kind" IN ('AGENT', 'HUMAN') AND length(trim("tax_case_itr_eligibility_facts"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tax_case_itr_eligibility_facts_scope` ON `tax_case_itr_eligibility_facts` (`tenant_id`,`tax_case_id`,`filing_snapshot_id`,`worksheet_id`,`field_name`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_tax_case_itr_eligibility_facts_id_scope` ON `tax_case_itr_eligibility_facts` (`id`,`tenant_id`,`tax_case_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tax_case_itr_form_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`evaluation_id` text NOT NULL,
	`expected_evaluation_hash` text NOT NULL,
	`selected_form` text NOT NULL,
	`pack_hash` text NOT NULL,
	`snapshot_candidate_hash` text NOT NULL,
	`worksheet_output_hash` text NOT NULL,
	`fact_set_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_case_id`,`tenant_id`) REFERENCES `tax_cases`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evaluation_id`,`tenant_id`,`tax_case_id`) REFERENCES `tax_case_itr_eligibility_evaluations`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_itr_form_selection_hashes" CHECK(length("tax_case_itr_form_selections"."expected_evaluation_hash") = 64 AND "tax_case_itr_form_selections"."expected_evaluation_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_itr_form_selections"."pack_hash") = 64 AND "tax_case_itr_form_selections"."pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_itr_form_selections"."snapshot_candidate_hash") = 64 AND "tax_case_itr_form_selections"."snapshot_candidate_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_itr_form_selections"."worksheet_output_hash") = 64 AND "tax_case_itr_form_selections"."worksheet_output_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_itr_form_selections"."fact_set_hash") = 64 AND "tax_case_itr_form_selections"."fact_set_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_itr_form_selections"."request_hash") = 64 AND "tax_case_itr_form_selections"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_tax_case_itr_form_selections_request` ON `tax_case_itr_form_selections` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tax_case_itr_form_selections_case` ON `tax_case_itr_form_selections` (`tenant_id`,`tax_case_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_tax_case_itr_eligibility_evaluations_id_scope` ON `tax_case_itr_eligibility_evaluations` (`id`,`tenant_id`,`tax_case_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_authority_packs_no_update` BEFORE UPDATE ON `personal_tax_authority_packs` BEGIN SELECT RAISE(ABORT, 'personal tax authority packs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_authority_packs_no_delete` BEFORE DELETE ON `personal_tax_authority_packs` BEGIN SELECT RAISE(ABORT, 'personal tax authority packs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_authority_pack_events_no_update` BEFORE UPDATE ON `personal_tax_authority_pack_events` BEGIN SELECT RAISE(ABORT, 'personal tax authority pack events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_authority_pack_events_no_delete` BEFORE DELETE ON `personal_tax_authority_pack_events` BEGIN SELECT RAISE(ABORT, 'personal tax authority pack events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tax_case_itr_eligibility_facts_no_update` BEFORE UPDATE ON `tax_case_itr_eligibility_facts` BEGIN SELECT RAISE(ABORT, 'tax case itr eligibility facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tax_case_itr_eligibility_facts_no_delete` BEFORE DELETE ON `tax_case_itr_eligibility_facts` BEGIN SELECT RAISE(ABORT, 'tax case itr eligibility facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tax_case_itr_eligibility_fact_events_no_update` BEFORE UPDATE ON `tax_case_itr_eligibility_fact_events` BEGIN SELECT RAISE(ABORT, 'tax case itr eligibility fact events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tax_case_itr_eligibility_fact_events_no_delete` BEFORE DELETE ON `tax_case_itr_eligibility_fact_events` BEGIN SELECT RAISE(ABORT, 'tax case itr eligibility fact events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tax_case_itr_eligibility_evaluations_no_update` BEFORE UPDATE ON `tax_case_itr_eligibility_evaluations` BEGIN SELECT RAISE(ABORT, 'tax case itr eligibility evaluations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tax_case_itr_eligibility_evaluations_no_delete` BEFORE DELETE ON `tax_case_itr_eligibility_evaluations` BEGIN SELECT RAISE(ABORT, 'tax case itr eligibility evaluations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tax_case_itr_form_selections_no_update` BEFORE UPDATE ON `tax_case_itr_form_selections` BEGIN SELECT RAISE(ABORT, 'tax case itr form selections are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `tax_case_itr_form_selections_no_delete` BEFORE DELETE ON `tax_case_itr_form_selections` BEGIN SELECT RAISE(ABORT, 'tax case itr form selections are immutable'); END;
