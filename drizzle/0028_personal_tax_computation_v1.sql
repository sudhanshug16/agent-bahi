CREATE UNIQUE INDEX IF NOT EXISTS `uq_tax_case_itr_form_selections_id_scope` ON `tax_case_itr_form_selections` (`id`,`tenant_id`,`tax_case_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personal_tax_computation_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`filing_snapshot_id` text NOT NULL,
	`snapshot_candidate_hash` text NOT NULL,
	`worksheet_id` text NOT NULL,
	`worksheet_output_hash` text NOT NULL,
	`evaluation_id` text NOT NULL,
	`evaluation_hash` text NOT NULL,
	`selection_id` text NOT NULL,
	`selection_hash` text NOT NULL,
	`computation_pack_id` text NOT NULL,
	`computation_pack_hash` text NOT NULL,
	`values_json` text NOT NULL,
	`input_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_case_id`,`tenant_id`) REFERENCES `tax_cases`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filing_snapshot_id`,`tenant_id`,`tax_case_id`) REFERENCES `filing_snapshots`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`worksheet_id`,`tenant_id`,`tax_case_id`) REFERENCES `personal_tax_position_worksheets`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evaluation_id`,`tenant_id`,`tax_case_id`) REFERENCES `tax_case_itr_eligibility_evaluations`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`selection_id`,`tenant_id`,`tax_case_id`) REFERENCES `tax_case_itr_form_selections`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`computation_pack_id`) REFERENCES `personal_tax_computation_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_computation_inputs_hashes" CHECK(length("personal_tax_computation_inputs"."snapshot_candidate_hash") = 64 AND "personal_tax_computation_inputs"."snapshot_candidate_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computation_inputs"."worksheet_output_hash") = 64 AND "personal_tax_computation_inputs"."worksheet_output_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computation_inputs"."evaluation_hash") = 64 AND "personal_tax_computation_inputs"."evaluation_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computation_inputs"."selection_hash") = 64 AND "personal_tax_computation_inputs"."selection_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computation_inputs"."computation_pack_hash") = 64 AND "personal_tax_computation_inputs"."computation_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computation_inputs"."input_hash") = 64 AND "personal_tax_computation_inputs"."input_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computation_inputs"."request_hash") = 64 AND "personal_tax_computation_inputs"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_computation_inputs_id_scope` ON `personal_tax_computation_inputs` (`id`,`tenant_id`,`tax_case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_computation_inputs_request` ON `personal_tax_computation_inputs` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_computation_inputs_case` ON `personal_tax_computation_inputs` (`tenant_id`,`tax_case_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personal_tax_computation_pack_events` (
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
	FOREIGN KEY (`pack_id`) REFERENCES `personal_tax_computation_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_computation_pack_event_type" CHECK("personal_tax_computation_pack_events"."event_type" IN ('REGISTERED','HUMAN_VERIFIED','REJECTED','SUPERSEDED')),
	CONSTRAINT "chk_personal_tax_computation_pack_event_actor" CHECK("personal_tax_computation_pack_events"."actor_kind" IN ('AGENT','HUMAN') AND length(trim("personal_tax_computation_pack_events"."actor_id")) > 0 AND ("personal_tax_computation_pack_events"."event_type" IN ('REGISTERED','SUPERSEDED') OR "personal_tax_computation_pack_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_personal_tax_computation_pack_event_hashes" CHECK(length("personal_tax_computation_pack_events"."expected_pack_hash") = 64 AND "personal_tax_computation_pack_events"."expected_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computation_pack_events"."request_hash") = 64 AND "personal_tax_computation_pack_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_computation_pack_events_request` ON `personal_tax_computation_pack_events` (`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_computation_pack_events_pack` ON `personal_tax_computation_pack_events` (`pack_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personal_tax_computation_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`authority_pack_id` text NOT NULL,
	`authority_pack_hash` text NOT NULL,
	`financial_year` text NOT NULL,
	`assessment_year` text NOT NULL,
	`itr_form` text NOT NULL,
	`pack_version` text NOT NULL,
	`provenance_artifacts_json` text NOT NULL,
	`declared_inputs_json` text NOT NULL,
	`named_schedules_json` text NOT NULL,
	`program_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`lifecycle` text DEFAULT 'PROPOSED' NOT NULL,
	`supersedes_pack_id` text,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`authority_pack_id`) REFERENCES `personal_tax_authority_packs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_pack_id`) REFERENCES `personal_tax_computation_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_computation_packs_lifecycle" CHECK("personal_tax_computation_packs"."lifecycle" IN ('PROPOSED','HUMAN_VERIFIED','REJECTED')),
	CONSTRAINT "chk_personal_tax_computation_packs_hashes" CHECK(length("personal_tax_computation_packs"."authority_pack_hash") = 64 AND "personal_tax_computation_packs"."authority_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computation_packs"."canonical_hash") = 64 AND "personal_tax_computation_packs"."canonical_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_computation_packs_hash` ON `personal_tax_computation_packs` (`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_computation_packs_identity` ON `personal_tax_computation_packs` (`authority_pack_id`,`itr_form`,`pack_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_computation_packs_applicable` ON `personal_tax_computation_packs` (`financial_year`,`assessment_year`,`itr_form`,`lifecycle`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personal_tax_computations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`filing_snapshot_id` text NOT NULL,
	`snapshot_candidate_hash` text NOT NULL,
	`worksheet_id` text NOT NULL,
	`worksheet_output_hash` text NOT NULL,
	`evaluation_id` text NOT NULL,
	`evaluation_hash` text NOT NULL,
	`selection_id` text NOT NULL,
	`selection_hash` text NOT NULL,
	`computation_pack_id` text NOT NULL,
	`computation_pack_hash` text NOT NULL,
	`input_set_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`computation_hash` text NOT NULL,
	`step_trace_json` text NOT NULL,
	`named_schedules_json` text NOT NULL,
	`gross_tax_minor` text NOT NULL,
	`credits_minor` text NOT NULL,
	`net_payable_minor` text,
	`refund_minor` text,
	`lifecycle` text DEFAULT 'GENERATED' NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_case_id`,`tenant_id`) REFERENCES `tax_cases`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`input_set_id`,`tenant_id`,`tax_case_id`) REFERENCES `personal_tax_computation_inputs`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`computation_pack_id`) REFERENCES `personal_tax_computation_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_computations_hashes" CHECK(length("personal_tax_computations"."computation_pack_hash") = 64 AND "personal_tax_computations"."computation_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computations"."input_hash") = 64 AND "personal_tax_computations"."input_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computations"."computation_hash") = 64 AND "personal_tax_computations"."computation_hash" NOT GLOB '*[^0-9a-f]*' AND ((net_payable_minor IS NULL AND refund_minor IS NOT NULL) OR (net_payable_minor IS NOT NULL AND refund_minor IS NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_computations_id_scope` ON `personal_tax_computations` (`id`,`tenant_id`,`tax_case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_computations_request` ON `personal_tax_computations` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_computations_case` ON `personal_tax_computations` (`tenant_id`,`tax_case_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personal_tax_computation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`computation_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`expected_computation_hash` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`computation_id`,`tenant_id`,`tax_case_id`) REFERENCES `personal_tax_computations`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_computation_event_type" CHECK("personal_tax_computation_events"."event_type" IN ('APPROVED')),
	CONSTRAINT "chk_personal_tax_computation_event_actor" CHECK("personal_tax_computation_events"."actor_kind" = 'HUMAN' AND length(trim("personal_tax_computation_events"."actor_id")) > 0),
	CONSTRAINT "chk_personal_tax_computation_event_hash" CHECK(length("personal_tax_computation_events"."expected_computation_hash") = 64 AND "personal_tax_computation_events"."expected_computation_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_computation_events"."request_hash") = 64 AND "personal_tax_computation_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_computation_events_request` ON `personal_tax_computation_events` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_computation_events_computation` ON `personal_tax_computation_events` (`tenant_id`,`tax_case_id`,`computation_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_computation_packs_no_update` BEFORE UPDATE ON `personal_tax_computation_packs` BEGIN SELECT RAISE(ABORT, 'personal tax computation packs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_computation_packs_no_delete` BEFORE DELETE ON `personal_tax_computation_packs` BEGIN SELECT RAISE(ABORT, 'personal tax computation packs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_computation_pack_events_no_update` BEFORE UPDATE ON `personal_tax_computation_pack_events` BEGIN SELECT RAISE(ABORT, 'personal tax computation pack events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_computation_pack_events_no_delete` BEFORE DELETE ON `personal_tax_computation_pack_events` BEGIN SELECT RAISE(ABORT, 'personal tax computation pack events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_computation_inputs_no_update` BEFORE UPDATE ON `personal_tax_computation_inputs` BEGIN SELECT RAISE(ABORT, 'personal tax computation inputs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_computation_inputs_no_delete` BEFORE DELETE ON `personal_tax_computation_inputs` BEGIN SELECT RAISE(ABORT, 'personal tax computation inputs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_computations_no_update` BEFORE UPDATE ON `personal_tax_computations` BEGIN SELECT RAISE(ABORT, 'personal tax computations are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_computations_no_delete` BEFORE DELETE ON `personal_tax_computations` BEGIN SELECT RAISE(ABORT, 'personal tax computations are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_computation_events_no_update` BEFORE UPDATE ON `personal_tax_computation_events` BEGIN SELECT RAISE(ABORT, 'personal tax computation events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_computation_events_no_delete` BEFORE DELETE ON `personal_tax_computation_events` BEGIN SELECT RAISE(ABORT, 'personal tax computation events are immutable'); END;
