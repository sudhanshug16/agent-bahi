CREATE TABLE `mca_annual_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`legal_identity_id` text NOT NULL,
	`financial_year` text NOT NULL,
	`form_family` text NOT NULL,
	`filing_type` text NOT NULL,
	`form_pack_id` text NOT NULL,
	`form_pack_hash` text NOT NULL,
	`fact_set_hash` text NOT NULL,
	`source_model_hash` text NOT NULL,
	`ledger_revision` integer NOT NULL,
	`close_pack_manifest_id` text NOT NULL,
	`close_pack_manifest_hash` text NOT NULL,
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
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`legal_identity_id`) REFERENCES `legal_identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`form_pack_id`) REFERENCES `mca_form_packs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`close_pack_manifest_id`,`tenant_id`,`book_set_id`) REFERENCES `close_pack_manifests`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`book_set_id`) REFERENCES `book_set_ledger_revisions`(`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_mca_annual_artifacts_identity" CHECK("mca_annual_artifacts"."form_family" IN ('AOC-4','AOC-4 XBRL','AOC-4 CFS','MGT-7','MGT-7A','ADT-1','MSME-1')),
	CONSTRAINT "chk_mca_annual_artifacts_hashes" CHECK(length("mca_annual_artifacts"."form_pack_hash") = 64 AND "mca_annual_artifacts"."form_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_annual_artifacts"."fact_set_hash") = 64 AND "mca_annual_artifacts"."fact_set_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_annual_artifacts"."source_model_hash") = 64 AND "mca_annual_artifacts"."source_model_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_annual_artifacts"."close_pack_manifest_hash") = 64 AND "mca_annual_artifacts"."close_pack_manifest_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_annual_artifacts"."content_hash") = 64 AND "mca_annual_artifacts"."content_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_annual_artifacts"."request_hash") = 64 AND "mca_annual_artifacts"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_mca_annual_artifacts_actor" CHECK("mca_annual_artifacts"."created_by_actor_kind" IN ('AGENT','HUMAN') AND length(trim("mca_annual_artifacts"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_annual_artifacts_scope_hash` ON `mca_annual_artifacts` (`tenant_id`,`book_set_id`,`financial_year`,`form_family`,`filing_type`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_annual_artifacts_request` ON `mca_annual_artifacts` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_annual_artifacts_id_scope` ON `mca_annual_artifacts` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_mca_annual_artifacts_scope` ON `mca_annual_artifacts` (`tenant_id`,`book_set_id`,`financial_year`,`form_family`,`created_at`);--> statement-breakpoint
CREATE TABLE `mca_annual_export_activities` (
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
	FOREIGN KEY (`artifact_id`,`tenant_id`,`book_set_id`) REFERENCES `mca_annual_artifacts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_mca_annual_export_actor" CHECK("mca_annual_export_activities"."actor_kind" = 'HUMAN' AND length(trim("mca_annual_export_activities"."actor_id")) > 0),
	CONSTRAINT "chk_mca_annual_export_hashes" CHECK(length("mca_annual_export_activities"."artifact_hash") = 64 AND "mca_annual_export_activities"."artifact_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_annual_export_activities"."validation_hash") = 64 AND "mca_annual_export_activities"."validation_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_annual_export_activities"."request_hash") = 64 AND "mca_annual_export_activities"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_annual_export_request` ON `mca_annual_export_activities` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_mca_annual_export_artifact` ON `mca_annual_export_activities` (`tenant_id`,`book_set_id`,`artifact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mca_annual_validation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`form_pack_hash` text NOT NULL,
	`validation_hash` text NOT NULL,
	`status` text NOT NULL,
	`diagnostics_json` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`artifact_id`,`tenant_id`,`book_set_id`) REFERENCES `mca_annual_artifacts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_mca_annual_validation_status" CHECK("mca_annual_validation_runs"."status" IN ('LOCAL_VALID','LOCAL_INVALID')),
	CONSTRAINT "chk_mca_annual_validation_hashes" CHECK(length("mca_annual_validation_runs"."artifact_hash") = 64 AND "mca_annual_validation_runs"."artifact_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_annual_validation_runs"."form_pack_hash") = 64 AND "mca_annual_validation_runs"."form_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_annual_validation_runs"."validation_hash") = 64 AND "mca_annual_validation_runs"."validation_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_annual_validation_runs"."request_hash") = 64 AND "mca_annual_validation_runs"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_annual_validation_request` ON `mca_annual_validation_runs` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_mca_annual_validation_artifact` ON `mca_annual_validation_runs` (`tenant_id`,`book_set_id`,`artifact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mca_applicability_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`form_pack_id` text NOT NULL,
	`legal_identity_id` text NOT NULL,
	`financial_year` text NOT NULL,
	`decision` text NOT NULL,
	`missing_keys_json` text NOT NULL,
	`rule_trace_json` text NOT NULL,
	`facts_hash` text NOT NULL,
	`pack_hash` text NOT NULL,
	`evaluated_at` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`form_pack_id`) REFERENCES `mca_form_packs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`legal_identity_id`) REFERENCES `legal_identities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_mca_applicability_decision" CHECK("mca_applicability_decisions"."decision" IN ('APPLICABLE','NOT_APPLICABLE_WITH_FACT','UNKNOWN','BLOCKED')),
	CONSTRAINT "chk_mca_applicability_hashes" CHECK(length("mca_applicability_decisions"."facts_hash") = 64 AND "mca_applicability_decisions"."facts_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_applicability_decisions"."pack_hash") = 64 AND "mca_applicability_decisions"."pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_applicability_decisions"."request_hash") = 64 AND "mca_applicability_decisions"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_applicability_input` ON `mca_applicability_decisions` (`tenant_id`,`book_set_id`,`form_pack_id`,`legal_identity_id`,`financial_year`,`facts_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_applicability_request` ON `mca_applicability_decisions` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_mca_applicability_scope` ON `mca_applicability_decisions` (`tenant_id`,`book_set_id`,`financial_year`,`form_pack_id`);--> statement-breakpoint
CREATE TABLE `mca_company_fact_events` (
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
	FOREIGN KEY (`fact_id`,`tenant_id`,`book_set_id`) REFERENCES `mca_company_facts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_mca_company_fact_event_type" CHECK("mca_company_fact_events"."event_type" IN ('PROPOSED','HUMAN_CONFIRMED','HUMAN_REJECTED')),
	CONSTRAINT "chk_mca_company_fact_event_actor" CHECK("mca_company_fact_events"."actor_kind" IN ('AGENT','HUMAN') AND length(trim("mca_company_fact_events"."actor_id")) > 0 AND ("mca_company_fact_events"."event_type" = 'PROPOSED' OR "mca_company_fact_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_mca_company_fact_event_hashes" CHECK(length("mca_company_fact_events"."expected_fact_hash") = 64 AND "mca_company_fact_events"."expected_fact_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_company_fact_events"."request_hash") = 64 AND "mca_company_fact_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_company_fact_events_request` ON `mca_company_fact_events` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_mca_company_fact_events_fact` ON `mca_company_fact_events` (`tenant_id`,`book_set_id`,`fact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mca_company_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`legal_identity_id` text NOT NULL,
	`financial_year` text NOT NULL,
	`fact_type` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`facts_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`evidence_ids_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`legal_identity_id`) REFERENCES `legal_identities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_mca_company_facts_dates" CHECK(length("mca_company_facts"."effective_from") = 10 AND ("mca_company_facts"."effective_to" IS NULL OR "mca_company_facts"."effective_from" <= "mca_company_facts"."effective_to")),
	CONSTRAINT "chk_mca_company_facts_hash" CHECK(length("mca_company_facts"."canonical_hash") = 64 AND "mca_company_facts"."canonical_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_company_facts"."request_hash") = 64 AND "mca_company_facts"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_mca_company_facts_actor" CHECK("mca_company_facts"."created_by_actor_kind" IN ('AGENT','HUMAN') AND length(trim("mca_company_facts"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_company_facts_scope_hash` ON `mca_company_facts` (`tenant_id`,`book_set_id`,`legal_identity_id`,`financial_year`,`fact_type`,`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_company_facts_request` ON `mca_company_facts` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_company_facts_id_scope` ON `mca_company_facts` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_mca_company_facts_scope` ON `mca_company_facts` (`tenant_id`,`book_set_id`,`legal_identity_id`,`financial_year`,`fact_type`,`effective_from`);--> statement-breakpoint
CREATE TABLE `mca_form_pack_events` (
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
	FOREIGN KEY (`pack_id`) REFERENCES `mca_form_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_mca_form_pack_event_type" CHECK("mca_form_pack_events"."event_type" IN ('REGISTERED','HUMAN_VERIFIED','REJECTED','SUPERSEDED')),
	CONSTRAINT "chk_mca_form_pack_event_actor" CHECK("mca_form_pack_events"."actor_kind" IN ('AGENT','HUMAN') AND length(trim("mca_form_pack_events"."actor_id")) > 0 AND ("mca_form_pack_events"."event_type" IN ('REGISTERED','SUPERSEDED') OR "mca_form_pack_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_mca_form_pack_event_hashes" CHECK(length("mca_form_pack_events"."expected_pack_hash") = 64 AND "mca_form_pack_events"."expected_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("mca_form_pack_events"."request_hash") = 64 AND "mca_form_pack_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_form_pack_events_request` ON `mca_form_pack_events` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_mca_form_pack_events_pack` ON `mca_form_pack_events` (`pack_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `mca_form_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`jurisdiction` text NOT NULL,
	`authority` text NOT NULL,
	`form_family` text NOT NULL,
	`filing_type` text NOT NULL,
	`financial_year` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`released_at` text NOT NULL,
	`law_reference` text NOT NULL,
	`rule_reference` text NOT NULL,
	`instruction_reference` text NOT NULL,
	`schema_reference` text NOT NULL,
	`artifact_references_json` text NOT NULL,
	`pack_version` text NOT NULL,
	`required_fact_declarations_json` text NOT NULL,
	`applicability_rule_ast_json` text NOT NULL,
	`validation_schema_json` text NOT NULL,
	`mapping_spec_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`test_only` integer NOT NULL,
	`supersedes_pack_id` text,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`supersedes_pack_id`) REFERENCES `mca_form_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_mca_form_packs_identity" CHECK("mca_form_packs"."jurisdiction" = 'IN' AND "mca_form_packs"."authority" = 'MCA' AND "mca_form_packs"."form_family" IN ('AOC-4','AOC-4 XBRL','AOC-4 CFS','MGT-7','MGT-7A','ADT-1','MSME-1')),
	CONSTRAINT "chk_mca_form_packs_hash" CHECK(length("mca_form_packs"."canonical_hash") = 64 AND "mca_form_packs"."canonical_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_mca_form_packs_test_only" CHECK("mca_form_packs"."test_only" = 1),
	CONSTRAINT "chk_mca_form_packs_actor" CHECK("mca_form_packs"."created_by_actor_kind" IN ('AGENT','HUMAN') AND length(trim("mca_form_packs"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_form_packs_hash` ON `mca_form_packs` (`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mca_form_packs_identity` ON `mca_form_packs` (`jurisdiction`,`authority`,`form_family`,`filing_type`,`financial_year`,`effective_from`,`pack_version`);--> statement-breakpoint
CREATE INDEX `idx_mca_form_packs_applicable` ON `mca_form_packs` (`form_family`,`financial_year`,`effective_from`,`effective_to`);
--> statement-breakpoint
CREATE TRIGGER `mca_form_packs_no_update` BEFORE UPDATE ON `mca_form_packs` BEGIN SELECT RAISE(ABORT, 'MCA form packs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_form_packs_no_delete` BEFORE DELETE ON `mca_form_packs` BEGIN SELECT RAISE(ABORT, 'MCA form packs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_form_pack_events_no_update` BEFORE UPDATE ON `mca_form_pack_events` BEGIN SELECT RAISE(ABORT, 'MCA form pack events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_form_pack_events_no_delete` BEFORE DELETE ON `mca_form_pack_events` BEGIN SELECT RAISE(ABORT, 'MCA form pack events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_company_facts_no_update` BEFORE UPDATE ON `mca_company_facts` BEGIN SELECT RAISE(ABORT, 'MCA company facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_company_facts_no_delete` BEFORE DELETE ON `mca_company_facts` BEGIN SELECT RAISE(ABORT, 'MCA company facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_company_fact_events_no_update` BEFORE UPDATE ON `mca_company_fact_events` BEGIN SELECT RAISE(ABORT, 'MCA company fact events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_company_fact_events_no_delete` BEFORE DELETE ON `mca_company_fact_events` BEGIN SELECT RAISE(ABORT, 'MCA company fact events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_applicability_decisions_no_update` BEFORE UPDATE ON `mca_applicability_decisions` BEGIN SELECT RAISE(ABORT, 'MCA applicability decisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_applicability_decisions_no_delete` BEFORE DELETE ON `mca_applicability_decisions` BEGIN SELECT RAISE(ABORT, 'MCA applicability decisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_annual_artifacts_no_update` BEFORE UPDATE ON `mca_annual_artifacts` BEGIN SELECT RAISE(ABORT, 'MCA annual artifacts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_annual_artifacts_no_delete` BEFORE DELETE ON `mca_annual_artifacts` BEGIN SELECT RAISE(ABORT, 'MCA annual artifacts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_annual_validation_runs_no_update` BEFORE UPDATE ON `mca_annual_validation_runs` BEGIN SELECT RAISE(ABORT, 'MCA annual validation runs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_annual_validation_runs_no_delete` BEFORE DELETE ON `mca_annual_validation_runs` BEGIN SELECT RAISE(ABORT, 'MCA annual validation runs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_annual_export_activities_no_update` BEFORE UPDATE ON `mca_annual_export_activities` BEGIN SELECT RAISE(ABORT, 'MCA annual export activities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `mca_annual_export_activities_no_delete` BEFORE DELETE ON `mca_annual_export_activities` BEGIN SELECT RAISE(ABORT, 'MCA annual export activities are immutable'); END;
