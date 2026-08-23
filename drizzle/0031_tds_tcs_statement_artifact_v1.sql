CREATE TABLE IF NOT EXISTS `withholding_statement_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`deductor_profile_id` text NOT NULL,
	`form` text NOT NULL,
	`financial_year` text NOT NULL,
	`quarter` text NOT NULL,
	`filing_type` text NOT NULL,
	`schema_pack_id` text NOT NULL,
	`schema_pack_hash` text NOT NULL,
	`source_model_hash` text NOT NULL,
	`content_type` text NOT NULL,
	`content_text` text NOT NULL,
	`content_byte_length` integer NOT NULL,
	`content_hash` text NOT NULL,
	`bindings_json` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deductor_profile_id`,`tenant_id`) REFERENCES `tenant_deductor_profiles`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schema_pack_id`) REFERENCES `withholding_statement_schema_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_statement_artifacts_form" CHECK("withholding_statement_artifacts"."form" IN ('24Q','26Q','27Q','27EQ') AND "withholding_statement_artifacts"."quarter" IN ('Q1','Q2','Q3','Q4')),
	CONSTRAINT "chk_withholding_statement_artifacts_hashes" CHECK(length("withholding_statement_artifacts"."schema_pack_hash") = 64 AND "withholding_statement_artifacts"."schema_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_artifacts"."source_model_hash") = 64 AND "withholding_statement_artifacts"."source_model_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_artifacts"."content_hash") = 64 AND "withholding_statement_artifacts"."content_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_artifacts"."request_hash") = 64 AND "withholding_statement_artifacts"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_withholding_statement_artifacts_actor" CHECK("withholding_statement_artifacts"."created_by_actor_kind" IN ('AGENT','HUMAN') AND length(trim("withholding_statement_artifacts"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_artifacts_scope_hash` ON `withholding_statement_artifacts` (`tenant_id`,`book_set_id`,`form`,`financial_year`,`quarter`,`filing_type`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_artifacts_request` ON `withholding_statement_artifacts` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_artifacts_id_scope` ON `withholding_statement_artifacts` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_withholding_statement_artifacts_scope` ON `withholding_statement_artifacts` (`tenant_id`,`book_set_id`,`form`,`financial_year`,`quarter`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `withholding_statement_export_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`validation_hash` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`,`tenant_id`,`book_set_id`) REFERENCES `withholding_statement_artifacts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_statement_export_activities_actor" CHECK("withholding_statement_export_activities"."actor_kind" = 'HUMAN' AND length(trim("withholding_statement_export_activities"."actor_id")) > 0),
	CONSTRAINT "chk_withholding_statement_export_activities_hashes" CHECK(length("withholding_statement_export_activities"."artifact_hash") = 64 AND "withholding_statement_export_activities"."artifact_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_export_activities"."validation_hash") = 64 AND "withholding_statement_export_activities"."validation_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_export_activities"."request_hash") = 64 AND "withholding_statement_export_activities"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_export_activities_request` ON `withholding_statement_export_activities` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_withholding_statement_export_activities_artifact` ON `withholding_statement_export_activities` (`tenant_id`,`book_set_id`,`artifact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `withholding_statement_fact_events` (
	`id` text PRIMARY KEY NOT NULL,
	`fact_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`expected_fact_hash` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`fact_id`,`tenant_id`,`book_set_id`) REFERENCES `withholding_statement_facts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_statement_fact_event_type" CHECK("withholding_statement_fact_events"."event_type" IN ('PROPOSED','HUMAN_CONFIRMED','HUMAN_REJECTED')),
	CONSTRAINT "chk_withholding_statement_fact_event_actor" CHECK("withholding_statement_fact_events"."actor_kind" IN ('AGENT','HUMAN') AND length(trim("withholding_statement_fact_events"."actor_id")) > 0 AND ("withholding_statement_fact_events"."event_type" = 'PROPOSED' OR "withholding_statement_fact_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_withholding_statement_fact_event_hashes" CHECK(length("withholding_statement_fact_events"."expected_fact_hash") = 64 AND "withholding_statement_fact_events"."expected_fact_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_fact_events"."request_hash") = 64 AND "withholding_statement_fact_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_fact_events_request` ON `withholding_statement_fact_events` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_withholding_statement_fact_events_fact` ON `withholding_statement_fact_events` (`tenant_id`,`book_set_id`,`fact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `withholding_statement_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`deductor_profile_id` text NOT NULL,
	`financial_year` text NOT NULL,
	`quarter` text NOT NULL,
	`fact_type` text NOT NULL,
	`deposit_id` text,
	`tan_pan_profile_reference` text,
	`responsible_person_json` text,
	`challan_json` text,
	`deductee_classification` text,
	`remittance_json` text,
	`correction_linkage` text,
	`nil_statement_assertion` integer DEFAULT 0 NOT NULL,
	`allocations_json` text NOT NULL,
	`facts_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deductor_profile_id`,`tenant_id`) REFERENCES `tenant_deductor_profiles`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deposit_id`,`tenant_id`,`book_set_id`) REFERENCES `withholding_deposits`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_statement_facts_type" CHECK("withholding_statement_facts"."fact_type" IN ('CHALLAN','RESPONSIBLE_PERSON','DEDUCTEE_CLASSIFICATION','NIL_STATEMENT','REMITTANCE','CORRECTION')),
	CONSTRAINT "chk_withholding_statement_facts_quarter" CHECK("withholding_statement_facts"."quarter" IN ('Q1','Q2','Q3','Q4')),
	CONSTRAINT "chk_withholding_statement_facts_nil" CHECK("withholding_statement_facts"."nil_statement_assertion" IN (0,1)),
	CONSTRAINT "chk_withholding_statement_facts_hashes" CHECK(length("withholding_statement_facts"."canonical_hash") = 64 AND "withholding_statement_facts"."canonical_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_facts"."request_hash") = 64 AND "withholding_statement_facts"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_withholding_statement_facts_actor" CHECK("withholding_statement_facts"."created_by_actor_kind" IN ('AGENT','HUMAN') AND length(trim("withholding_statement_facts"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_facts_scope_hash` ON `withholding_statement_facts` (`tenant_id`,`book_set_id`,`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_facts_request` ON `withholding_statement_facts` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_withholding_statement_facts_scope_period` ON `withholding_statement_facts` (`tenant_id`,`book_set_id`,`deductor_profile_id`,`financial_year`,`quarter`,`fact_type`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_facts_id_scope` ON `withholding_statement_facts` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `withholding_statement_schema_pack_events` (
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
	FOREIGN KEY (`pack_id`) REFERENCES `withholding_statement_schema_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_statement_schema_pack_event_type" CHECK("withholding_statement_schema_pack_events"."event_type" IN ('REGISTERED','HUMAN_VERIFIED','REJECTED','SUPERSEDED')),
	CONSTRAINT "chk_withholding_statement_schema_pack_event_actor" CHECK("withholding_statement_schema_pack_events"."actor_kind" IN ('AGENT','HUMAN') AND length(trim("withholding_statement_schema_pack_events"."actor_id")) > 0 AND ("withholding_statement_schema_pack_events"."event_type" IN ('REGISTERED','SUPERSEDED') OR "withholding_statement_schema_pack_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_withholding_statement_schema_pack_event_hashes" CHECK(length("withholding_statement_schema_pack_events"."expected_pack_hash") = 64 AND "withholding_statement_schema_pack_events"."expected_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_schema_pack_events"."request_hash") = 64 AND "withholding_statement_schema_pack_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_schema_pack_events_request` ON `withholding_statement_schema_pack_events` (`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_withholding_statement_schema_pack_events_pack` ON `withholding_statement_schema_pack_events` (`pack_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `withholding_statement_schema_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`jurisdiction` text NOT NULL,
	`form` text NOT NULL,
	`financial_year` text NOT NULL,
	`quarter` text NOT NULL,
	`filing_type` text NOT NULL,
	`authority_rule_snapshot_reference` text NOT NULL,
	`artifact_references_json` text NOT NULL,
	`pack_version` text NOT NULL,
	`validation_schema_json` text NOT NULL,
	`mapping_spec_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`supersedes_pack_id` text,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`supersedes_pack_id`) REFERENCES `withholding_statement_schema_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_statement_schema_packs_identity" CHECK("withholding_statement_schema_packs"."jurisdiction" = 'IN' AND "withholding_statement_schema_packs"."form" IN ('24Q','26Q','27Q','27EQ') AND "withholding_statement_schema_packs"."quarter" IN ('Q1','Q2','Q3','Q4') AND "withholding_statement_schema_packs"."filing_type" IN ('ORIGINAL','CORRECTION')),
	CONSTRAINT "chk_withholding_statement_schema_packs_hashes" CHECK(length("withholding_statement_schema_packs"."canonical_hash") = 64 AND "withholding_statement_schema_packs"."canonical_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_withholding_statement_schema_packs_actor" CHECK("withholding_statement_schema_packs"."created_by_actor_kind" IN ('AGENT','HUMAN') AND length(trim("withholding_statement_schema_packs"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_schema_packs_hash` ON `withholding_statement_schema_packs` (`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_schema_packs_identity` ON `withholding_statement_schema_packs` (`jurisdiction`,`form`,`financial_year`,`quarter`,`filing_type`,`pack_version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_withholding_statement_schema_packs_applicable` ON `withholding_statement_schema_packs` (`jurisdiction`,`form`,`financial_year`,`quarter`,`filing_type`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `withholding_statement_validation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
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
	FOREIGN KEY (`artifact_id`,`tenant_id`,`book_set_id`) REFERENCES `withholding_statement_artifacts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_statement_validation_runs_status" CHECK("withholding_statement_validation_runs"."status" IN ('LOCAL_VALID','LOCAL_INVALID')),
	CONSTRAINT "chk_withholding_statement_validation_runs_hashes" CHECK(length("withholding_statement_validation_runs"."artifact_hash") = 64 AND "withholding_statement_validation_runs"."artifact_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_validation_runs"."schema_pack_hash") = 64 AND "withholding_statement_validation_runs"."schema_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_validation_runs"."validation_hash") = 64 AND "withholding_statement_validation_runs"."validation_hash" NOT GLOB '*[^0-9a-f]*' AND length("withholding_statement_validation_runs"."request_hash") = 64 AND "withholding_statement_validation_runs"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_withholding_statement_validation_runs_request` ON `withholding_statement_validation_runs` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_withholding_statement_validation_runs_artifact` ON `withholding_statement_validation_runs` (`tenant_id`,`book_set_id`,`artifact_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_schema_packs_no_update` BEFORE UPDATE ON `withholding_statement_schema_packs` BEGIN SELECT RAISE(ABORT, 'withholding statement schema packs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_schema_packs_no_delete` BEFORE DELETE ON `withholding_statement_schema_packs` BEGIN SELECT RAISE(ABORT, 'withholding statement schema packs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_schema_pack_events_no_update` BEFORE UPDATE ON `withholding_statement_schema_pack_events` BEGIN SELECT RAISE(ABORT, 'withholding statement schema pack events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_schema_pack_events_no_delete` BEFORE DELETE ON `withholding_statement_schema_pack_events` BEGIN SELECT RAISE(ABORT, 'withholding statement schema pack events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_facts_no_update` BEFORE UPDATE ON `withholding_statement_facts` BEGIN SELECT RAISE(ABORT, 'withholding statement facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_facts_no_delete` BEFORE DELETE ON `withholding_statement_facts` BEGIN SELECT RAISE(ABORT, 'withholding statement facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_fact_events_no_update` BEFORE UPDATE ON `withholding_statement_fact_events` BEGIN SELECT RAISE(ABORT, 'withholding statement fact events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_fact_events_no_delete` BEFORE DELETE ON `withholding_statement_fact_events` BEGIN SELECT RAISE(ABORT, 'withholding statement fact events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_artifacts_no_update` BEFORE UPDATE ON `withholding_statement_artifacts` BEGIN SELECT RAISE(ABORT, 'withholding statement artifacts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_artifacts_no_delete` BEFORE DELETE ON `withholding_statement_artifacts` BEGIN SELECT RAISE(ABORT, 'withholding statement artifacts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_validation_runs_no_update` BEFORE UPDATE ON `withholding_statement_validation_runs` BEGIN SELECT RAISE(ABORT, 'withholding statement validation runs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_validation_runs_no_delete` BEFORE DELETE ON `withholding_statement_validation_runs` BEGIN SELECT RAISE(ABORT, 'withholding statement validation runs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_export_activities_no_update` BEFORE UPDATE ON `withholding_statement_export_activities` BEGIN SELECT RAISE(ABORT, 'withholding statement export activities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `withholding_statement_export_activities_no_delete` BEFORE DELETE ON `withholding_statement_export_activities` BEGIN SELECT RAISE(ABORT, 'withholding statement export activities are immutable'); END;
