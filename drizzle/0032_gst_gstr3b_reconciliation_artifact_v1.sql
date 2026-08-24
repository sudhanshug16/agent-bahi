CREATE TABLE `gst_gstr3b_schema_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`jurisdiction` text NOT NULL,
	`return_type` text NOT NULL,
	`filing_frequency` text NOT NULL,
	`applicable_from` text NOT NULL,
	`applicable_to` text,
	`readiness_contract_version` text NOT NULL,
	`rule_snapshot_reference` text NOT NULL,
	`artifact_references_json` text NOT NULL,
	`pack_version` text NOT NULL,
	`lane_spec_json` text NOT NULL,
	`validation_schema_json` text NOT NULL,
	`mapping_spec_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`supersedes_pack_id` text,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`supersedes_pack_id`) REFERENCES `gst_gstr3b_schema_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_gst_gstr3b_schema_packs_identity" CHECK("gst_gstr3b_schema_packs"."jurisdiction" = 'IN' AND "gst_gstr3b_schema_packs"."return_type" = 'GSTR3B' AND "gst_gstr3b_schema_packs"."filing_frequency" IN ('MONTHLY','QUARTERLY')),
	CONSTRAINT "chk_gst_gstr3b_schema_packs_hashes" CHECK(length("gst_gstr3b_schema_packs"."canonical_hash") = 64 AND "gst_gstr3b_schema_packs"."canonical_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_gst_gstr3b_schema_packs_actor" CHECK("gst_gstr3b_schema_packs"."created_by_actor_kind" IN ('AGENT','HUMAN') AND length(trim("gst_gstr3b_schema_packs"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_schema_packs_hash` ON `gst_gstr3b_schema_packs` (`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_schema_packs_identity` ON `gst_gstr3b_schema_packs` (`jurisdiction`,`return_type`,`filing_frequency`,`applicable_from`,`pack_version`);--> statement-breakpoint
CREATE INDEX `idx_gst_gstr3b_schema_packs_applicable` ON `gst_gstr3b_schema_packs` (`jurisdiction`,`return_type`,`filing_frequency`,`applicable_from`,`applicable_to`);--> statement-breakpoint
CREATE TABLE `gst_gstr3b_schema_pack_events` (
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
	FOREIGN KEY (`pack_id`) REFERENCES `gst_gstr3b_schema_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_gst_gstr3b_schema_pack_event_type" CHECK("gst_gstr3b_schema_pack_events"."event_type" IN ('REGISTERED','HUMAN_VERIFIED','REJECTED','SUPERSEDED')),
	CONSTRAINT "chk_gst_gstr3b_schema_pack_event_actor" CHECK("gst_gstr3b_schema_pack_events"."actor_kind" IN ('AGENT','HUMAN') AND length(trim("gst_gstr3b_schema_pack_events"."actor_id")) > 0 AND ("gst_gstr3b_schema_pack_events"."event_type" IN ('REGISTERED','SUPERSEDED') OR "gst_gstr3b_schema_pack_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_gst_gstr3b_schema_pack_event_hashes" CHECK(length("gst_gstr3b_schema_pack_events"."expected_pack_hash") = 64 AND "gst_gstr3b_schema_pack_events"."expected_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("gst_gstr3b_schema_pack_events"."request_hash") = 64 AND "gst_gstr3b_schema_pack_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_schema_pack_events_request` ON `gst_gstr3b_schema_pack_events` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_gst_gstr3b_schema_pack_events_pack` ON `gst_gstr3b_schema_pack_events` (`pack_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `gst_gstr3b_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`gstin` text NOT NULL,
	`tax_period_from` text NOT NULL,
	`tax_period_to` text NOT NULL,
	`fact_type` text NOT NULL,
	`facts_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_gst_gstr3b_facts_type" CHECK("gst_gstr3b_facts"."fact_type" IN ('PORTAL_GSTR1_LIABILITY','PORTAL_GSTR2B_ITC','REVERSE_CHARGE_INWARD','IMPORT_GOODS_ITC','IMPORT_SERVICES_ITC','INELIGIBLE_ITC','ITC_REVERSAL','ITC_RECLAIM','INTEREST_LATE_FEE','CASH_LEDGER','CREDIT_LEDGER','TAX_DEPOSIT','NIL_EXEMPT_NONGST','INTERSTATE_UNREGISTERED_SUMMARY','ECOMMERCE_9_5')),
	CONSTRAINT "chk_gst_gstr3b_facts_period" CHECK(length("gst_gstr3b_facts"."tax_period_from") = 10 AND length("gst_gstr3b_facts"."tax_period_to") = 10 AND "gst_gstr3b_facts"."tax_period_from" <= "gst_gstr3b_facts"."tax_period_to"),
	CONSTRAINT "chk_gst_gstr3b_facts_gstin" CHECK(length("gst_gstr3b_facts"."gstin") = 15),
	CONSTRAINT "chk_gst_gstr3b_facts_hashes" CHECK(length("gst_gstr3b_facts"."canonical_hash") = 64 AND "gst_gstr3b_facts"."canonical_hash" NOT GLOB '*[^0-9a-f]*' AND length("gst_gstr3b_facts"."request_hash") = 64 AND "gst_gstr3b_facts"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_gst_gstr3b_facts_actor" CHECK("gst_gstr3b_facts"."created_by_actor_kind" IN ('AGENT','HUMAN') AND length(trim("gst_gstr3b_facts"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_facts_scope_hash` ON `gst_gstr3b_facts` (`tenant_id`,`book_set_id`,`gstin`,`tax_period_from`,`tax_period_to`,`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_facts_request` ON `gst_gstr3b_facts` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_facts_id_scope` ON `gst_gstr3b_facts` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_gst_gstr3b_facts_scope_period` ON `gst_gstr3b_facts` (`tenant_id`,`book_set_id`,`gstin`,`tax_period_from`,`tax_period_to`,`fact_type`);--> statement-breakpoint
CREATE TABLE `gst_gstr3b_fact_events` (
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
	FOREIGN KEY (`fact_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_gstr3b_facts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_gst_gstr3b_fact_event_type" CHECK("gst_gstr3b_fact_events"."event_type" IN ('PROPOSED','HUMAN_CONFIRMED','HUMAN_REJECTED')),
	CONSTRAINT "chk_gst_gstr3b_fact_event_actor" CHECK("gst_gstr3b_fact_events"."actor_kind" IN ('AGENT','HUMAN') AND length(trim("gst_gstr3b_fact_events"."actor_id")) > 0 AND ("gst_gstr3b_fact_events"."event_type" = 'PROPOSED' OR "gst_gstr3b_fact_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_gst_gstr3b_fact_event_hashes" CHECK(length("gst_gstr3b_fact_events"."expected_fact_hash") = 64 AND "gst_gstr3b_fact_events"."expected_fact_hash" NOT GLOB '*[^0-9a-f]*' AND length("gst_gstr3b_fact_events"."request_hash") = 64 AND "gst_gstr3b_fact_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_fact_events_request` ON `gst_gstr3b_fact_events` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_gst_gstr3b_fact_events_fact` ON `gst_gstr3b_fact_events` (`tenant_id`,`book_set_id`,`fact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `gst_gstr3b_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`registration_id` text NOT NULL,
	`gstin` text NOT NULL,
	`filing_frequency` text NOT NULL,
	`tax_period_from` text NOT NULL,
	`tax_period_to` text NOT NULL,
	`schema_pack_id` text NOT NULL,
	`schema_pack_hash` text NOT NULL,
	`source_model_hash` text NOT NULL,
	`gstr1_artifact_id` text,
	`gstr1_artifact_hash` text,
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
	FOREIGN KEY (`registration_id`,`tenant_id`) REFERENCES `gst_registrations`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schema_pack_id`) REFERENCES `gst_gstr3b_schema_packs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_gst_gstr3b_artifacts_identity" CHECK("gst_gstr3b_artifacts"."filing_frequency" IN ('MONTHLY','QUARTERLY') AND length("gst_gstr3b_artifacts"."gstin") = 15),
	CONSTRAINT "chk_gst_gstr3b_artifacts_hashes" CHECK(length("gst_gstr3b_artifacts"."schema_pack_hash") = 64 AND "gst_gstr3b_artifacts"."schema_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("gst_gstr3b_artifacts"."source_model_hash") = 64 AND "gst_gstr3b_artifacts"."source_model_hash" NOT GLOB '*[^0-9a-f]*' AND ("gst_gstr3b_artifacts"."gstr1_artifact_hash" IS NULL OR (length("gst_gstr3b_artifacts"."gstr1_artifact_hash") = 64 AND "gst_gstr3b_artifacts"."gstr1_artifact_hash" NOT GLOB '*[^0-9a-f]*')) AND length("gst_gstr3b_artifacts"."content_hash") = 64 AND "gst_gstr3b_artifacts"."content_hash" NOT GLOB '*[^0-9a-f]*' AND length("gst_gstr3b_artifacts"."request_hash") = 64 AND "gst_gstr3b_artifacts"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_gst_gstr3b_artifacts_actor" CHECK("gst_gstr3b_artifacts"."created_by_actor_kind" IN ('AGENT','HUMAN') AND length(trim("gst_gstr3b_artifacts"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_artifacts_scope_hash` ON `gst_gstr3b_artifacts` (`tenant_id`,`book_set_id`,`gstin`,`tax_period_from`,`tax_period_to`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_artifacts_request` ON `gst_gstr3b_artifacts` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_artifacts_id_scope` ON `gst_gstr3b_artifacts` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_gst_gstr3b_artifacts_scope_period` ON `gst_gstr3b_artifacts` (`tenant_id`,`book_set_id`,`gstin`,`tax_period_from`,`tax_period_to`,`created_at`);--> statement-breakpoint
CREATE TABLE `gst_gstr3b_validation_runs` (
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
	FOREIGN KEY (`artifact_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_gstr3b_artifacts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_gst_gstr3b_validation_runs_status" CHECK("gst_gstr3b_validation_runs"."status" IN ('LOCAL_VALID','LOCAL_INVALID')),
	CONSTRAINT "chk_gst_gstr3b_validation_runs_hashes" CHECK(length("gst_gstr3b_validation_runs"."artifact_hash") = 64 AND "gst_gstr3b_validation_runs"."artifact_hash" NOT GLOB '*[^0-9a-f]*' AND length("gst_gstr3b_validation_runs"."schema_pack_hash") = 64 AND "gst_gstr3b_validation_runs"."schema_pack_hash" NOT GLOB '*[^0-9a-f]*' AND length("gst_gstr3b_validation_runs"."validation_hash") = 64 AND "gst_gstr3b_validation_runs"."validation_hash" NOT GLOB '*[^0-9a-f]*' AND length("gst_gstr3b_validation_runs"."request_hash") = 64 AND "gst_gstr3b_validation_runs"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_validation_runs_request` ON `gst_gstr3b_validation_runs` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_gst_gstr3b_validation_runs_artifact` ON `gst_gstr3b_validation_runs` (`tenant_id`,`book_set_id`,`artifact_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `gst_gstr3b_export_activities` (
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
	FOREIGN KEY (`artifact_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_gstr3b_artifacts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_gst_gstr3b_export_activities_actor" CHECK("gst_gstr3b_export_activities"."actor_kind" = 'HUMAN' AND length(trim("gst_gstr3b_export_activities"."actor_id")) > 0),
	CONSTRAINT "chk_gst_gstr3b_export_activities_hashes" CHECK(length("gst_gstr3b_export_activities"."artifact_hash") = 64 AND "gst_gstr3b_export_activities"."artifact_hash" NOT GLOB '*[^0-9a-f]*' AND length("gst_gstr3b_export_activities"."validation_hash") = 64 AND "gst_gstr3b_export_activities"."validation_hash" NOT GLOB '*[^0-9a-f]*' AND length("gst_gstr3b_export_activities"."request_hash") = 64 AND "gst_gstr3b_export_activities"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_gstr3b_export_activities_request` ON `gst_gstr3b_export_activities` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_gst_gstr3b_export_activities_artifact` ON `gst_gstr3b_export_activities` (`tenant_id`,`book_set_id`,`artifact_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_schema_packs_no_update` BEFORE UPDATE ON `gst_gstr3b_schema_packs` BEGIN SELECT RAISE(ABORT, 'GSTR-3B schema packs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_schema_packs_no_delete` BEFORE DELETE ON `gst_gstr3b_schema_packs` BEGIN SELECT RAISE(ABORT, 'GSTR-3B schema packs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_schema_pack_events_no_update` BEFORE UPDATE ON `gst_gstr3b_schema_pack_events` BEGIN SELECT RAISE(ABORT, 'GSTR-3B schema pack events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_schema_pack_events_no_delete` BEFORE DELETE ON `gst_gstr3b_schema_pack_events` BEGIN SELECT RAISE(ABORT, 'GSTR-3B schema pack events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_facts_no_update` BEFORE UPDATE ON `gst_gstr3b_facts` BEGIN SELECT RAISE(ABORT, 'GSTR-3B facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_facts_no_delete` BEFORE DELETE ON `gst_gstr3b_facts` BEGIN SELECT RAISE(ABORT, 'GSTR-3B facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_fact_events_no_update` BEFORE UPDATE ON `gst_gstr3b_fact_events` BEGIN SELECT RAISE(ABORT, 'GSTR-3B fact events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_fact_events_no_delete` BEFORE DELETE ON `gst_gstr3b_fact_events` BEGIN SELECT RAISE(ABORT, 'GSTR-3B fact events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_artifacts_no_update` BEFORE UPDATE ON `gst_gstr3b_artifacts` BEGIN SELECT RAISE(ABORT, 'GSTR-3B artifacts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_artifacts_no_delete` BEFORE DELETE ON `gst_gstr3b_artifacts` BEGIN SELECT RAISE(ABORT, 'GSTR-3B artifacts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_validation_runs_no_update` BEFORE UPDATE ON `gst_gstr3b_validation_runs` BEGIN SELECT RAISE(ABORT, 'GSTR-3B validation runs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_validation_runs_no_delete` BEFORE DELETE ON `gst_gstr3b_validation_runs` BEGIN SELECT RAISE(ABORT, 'GSTR-3B validation runs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_export_activities_no_update` BEFORE UPDATE ON `gst_gstr3b_export_activities` BEGIN SELECT RAISE(ABORT, 'GSTR-3B export activities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `gst_gstr3b_export_activities_no_delete` BEFORE DELETE ON `gst_gstr3b_export_activities` BEGIN SELECT RAISE(ABORT, 'GSTR-3B export activities are immutable'); END;
