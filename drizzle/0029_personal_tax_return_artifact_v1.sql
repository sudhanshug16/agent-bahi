CREATE TABLE IF NOT EXISTS `personal_tax_return_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`filing_snapshot_id` text NOT NULL,
	`worksheet_id` text NOT NULL,
	`evaluation_id` text NOT NULL,
	`selection_id` text NOT NULL,
	`computation_id` text NOT NULL,
	`schema_pack_id` text NOT NULL,
	`schema_pack_hash` text NOT NULL,
	`content_json` text NOT NULL,
	`content_byte_length` integer NOT NULL,
	`content_hash` text NOT NULL,
	`bindings_json` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_case_id`,`tenant_id`) REFERENCES `tax_cases`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_return_artifacts_hashes" CHECK(length("personal_tax_return_artifacts"."schema_pack_hash") = 64 AND "personal_tax_return_artifacts"."schema_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_return_artifacts"."content_hash") = 64 AND "personal_tax_return_artifacts"."content_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_return_artifacts"."request_hash") = 64 AND "personal_tax_return_artifacts"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_personal_tax_return_artifacts_actor" CHECK("personal_tax_return_artifacts"."created_by_actor_kind" IN ('AGENT', 'HUMAN') AND length(trim("personal_tax_return_artifacts"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_return_artifacts_scope_hash` ON `personal_tax_return_artifacts` (`tenant_id`,`tax_case_id`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_return_artifacts_id_scope` ON `personal_tax_return_artifacts` (`id`,`tenant_id`,`tax_case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_return_artifacts_request` ON `personal_tax_return_artifacts` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_return_artifacts_case` ON `personal_tax_return_artifacts` (`tenant_id`,`tax_case_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personal_tax_return_export_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`validation_hash` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`,`tenant_id`,`tax_case_id`) REFERENCES `personal_tax_return_artifacts`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_return_export_activities_actor" CHECK("personal_tax_return_export_activities"."actor_kind" = 'HUMAN' AND length(trim("personal_tax_return_export_activities"."actor_id")) > 0),
	CONSTRAINT "chk_personal_tax_return_export_activities_hashes" CHECK(length("personal_tax_return_export_activities"."artifact_hash") = 64 AND "personal_tax_return_export_activities"."artifact_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_return_export_activities"."validation_hash") = 64 AND "personal_tax_return_export_activities"."validation_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_return_export_activities"."request_hash") = 64 AND "personal_tax_return_export_activities"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_return_export_activities_request` ON `personal_tax_return_export_activities` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_return_export_activities_artifact` ON `personal_tax_return_export_activities` (`tenant_id`,`tax_case_id`,`artifact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personal_tax_return_schema_pack_events` (
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
	FOREIGN KEY (`pack_id`) REFERENCES `personal_tax_return_schema_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_return_schema_pack_event_type" CHECK("personal_tax_return_schema_pack_events"."event_type" IN ('REGISTERED', 'HUMAN_VERIFIED', 'REJECTED', 'SUPERSEDED')),
	CONSTRAINT "chk_personal_tax_return_schema_pack_event_actor" CHECK("personal_tax_return_schema_pack_events"."actor_kind" IN ('AGENT', 'HUMAN') AND length(trim("personal_tax_return_schema_pack_events"."actor_id")) > 0 AND ("personal_tax_return_schema_pack_events"."event_type" IN ('REGISTERED', 'SUPERSEDED') OR "personal_tax_return_schema_pack_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_personal_tax_return_schema_pack_event_hashes" CHECK(length("personal_tax_return_schema_pack_events"."expected_pack_hash") = 64 AND "personal_tax_return_schema_pack_events"."expected_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_return_schema_pack_events"."request_hash") = 64 AND "personal_tax_return_schema_pack_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_return_schema_pack_events_request` ON `personal_tax_return_schema_pack_events` (`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_return_schema_pack_events_pack` ON `personal_tax_return_schema_pack_events` (`pack_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personal_tax_return_schema_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`authority_pack_id` text NOT NULL,
	`authority_pack_hash` text NOT NULL,
	`itr_form` text NOT NULL,
	`filing_type` text NOT NULL,
	`financial_year` text NOT NULL,
	`assessment_year` text NOT NULL,
	`artifact_references_json` text NOT NULL,
	`pack_version` text NOT NULL,
	`validation_schema_json` text NOT NULL,
	`mapping_spec_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`supersedes_pack_id` text,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`authority_pack_id`) REFERENCES `personal_tax_authority_packs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_pack_id`) REFERENCES `personal_tax_return_schema_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_return_schema_packs_hashes" CHECK(length("personal_tax_return_schema_packs"."authority_pack_hash") = 64 AND "personal_tax_return_schema_packs"."authority_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_return_schema_packs"."canonical_hash") = 64 AND "personal_tax_return_schema_packs"."canonical_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_personal_tax_return_schema_packs_actor" CHECK("personal_tax_return_schema_packs"."created_by_actor_kind" IN ('AGENT', 'HUMAN') AND length(trim("personal_tax_return_schema_packs"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_return_schema_packs_hash` ON `personal_tax_return_schema_packs` (`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_return_schema_packs_identity` ON `personal_tax_return_schema_packs` (`authority_pack_id`,`itr_form`,`filing_type`,`pack_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_return_schema_packs_applicable` ON `personal_tax_return_schema_packs` (`financial_year`,`assessment_year`,`itr_form`,`filing_type`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `personal_tax_return_validation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`schema_pack_hash` text NOT NULL,
	`validation_hash` text NOT NULL,
	`status` text NOT NULL,
	`diagnostics_json` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`artifact_id`,`tenant_id`,`tax_case_id`) REFERENCES `personal_tax_return_artifacts`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_return_validation_runs_status" CHECK("personal_tax_return_validation_runs"."status" IN ('LOCAL_VALID', 'LOCAL_INVALID')),
	CONSTRAINT "chk_personal_tax_return_validation_runs_hashes" CHECK(length("personal_tax_return_validation_runs"."artifact_hash") = 64 AND "personal_tax_return_validation_runs"."artifact_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_return_validation_runs"."schema_pack_hash") = 64 AND "personal_tax_return_validation_runs"."schema_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_return_validation_runs"."validation_hash") = 64 AND "personal_tax_return_validation_runs"."validation_hash" NOT GLOB '*[^0-9a-f]*' AND length("personal_tax_return_validation_runs"."request_hash") = 64 AND "personal_tax_return_validation_runs"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_personal_tax_return_validation_runs_request` ON `personal_tax_return_validation_runs` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_personal_tax_return_validation_runs_artifact` ON `personal_tax_return_validation_runs` (`tenant_id`,`tax_case_id`,`artifact_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_return_schema_packs_no_update` BEFORE UPDATE ON `personal_tax_return_schema_packs` BEGIN SELECT RAISE(ABORT, 'personal tax return schema packs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_return_schema_packs_no_delete` BEFORE DELETE ON `personal_tax_return_schema_packs` BEGIN SELECT RAISE(ABORT, 'personal tax return schema packs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_return_schema_pack_events_no_update` BEFORE UPDATE ON `personal_tax_return_schema_pack_events` BEGIN SELECT RAISE(ABORT, 'personal tax return schema pack events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_return_schema_pack_events_no_delete` BEFORE DELETE ON `personal_tax_return_schema_pack_events` BEGIN SELECT RAISE(ABORT, 'personal tax return schema pack events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_return_artifacts_no_update` BEFORE UPDATE ON `personal_tax_return_artifacts` BEGIN SELECT RAISE(ABORT, 'personal tax return artifacts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_return_artifacts_no_delete` BEFORE DELETE ON `personal_tax_return_artifacts` BEGIN SELECT RAISE(ABORT, 'personal tax return artifacts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_return_validation_runs_no_update` BEFORE UPDATE ON `personal_tax_return_validation_runs` BEGIN SELECT RAISE(ABORT, 'personal tax return validation runs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_return_validation_runs_no_delete` BEFORE DELETE ON `personal_tax_return_validation_runs` BEGIN SELECT RAISE(ABORT, 'personal tax return validation runs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_return_export_activities_no_update` BEFORE UPDATE ON `personal_tax_return_export_activities` BEGIN SELECT RAISE(ABORT, 'personal tax return export activities are immutable'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `personal_tax_return_export_activities_no_delete` BEFORE DELETE ON `personal_tax_return_export_activities` BEGIN SELECT RAISE(ABORT, 'personal tax return export activities are immutable'); END;
