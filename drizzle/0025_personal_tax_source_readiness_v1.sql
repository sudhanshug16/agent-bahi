CREATE TABLE `tax_case_source_assessment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`source_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`expected_assessment_hash` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`assessment_id`,`tenant_id`,`tax_case_id`,`source_id`) REFERENCES `tax_case_source_assessments`(`id`,`tenant_id`,`tax_case_id`,`source_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_source_assessment_event_type" CHECK("tax_case_source_assessment_events"."event_type" IN ('PREPARED', 'CONFIRMED', 'REJECTED', 'SUPERSEDED')),
	CONSTRAINT "chk_tax_case_source_assessment_event_actor" CHECK("tax_case_source_assessment_events"."actor_kind" IN ('HUMAN', 'AGENT') AND length(trim("tax_case_source_assessment_events"."actor_id")) > 0 AND ("tax_case_source_assessment_events"."event_type" IN ('PREPARED', 'SUPERSEDED') OR "tax_case_source_assessment_events"."actor_kind" = 'HUMAN')),
	CONSTRAINT "chk_tax_case_source_assessment_event_hashes" CHECK(length("tax_case_source_assessment_events"."expected_assessment_hash") = 64 AND "tax_case_source_assessment_events"."expected_assessment_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_source_assessment_events"."request_hash") = 64 AND "tax_case_source_assessment_events"."request_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_source_assessment_events_request` ON `tax_case_source_assessment_events` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_tax_case_source_assessment_events_assessment` ON `tax_case_source_assessment_events` (`tenant_id`,`tax_case_id`,`source_id`,`assessment_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `tax_case_source_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`source_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`assessor_actor_kind` text NOT NULL,
	`assessor_actor_id` text NOT NULL,
	`assessed_at` text NOT NULL,
	`parser_identity` text NOT NULL,
	`parser_version` text NOT NULL,
	`model_descriptor` text NOT NULL,
	`extraction_mode` text NOT NULL,
	`declared_source_kind` text NOT NULL,
	`declared_source_period` text,
	`declared_source_as_of` text,
	`record_count` integer,
	`page_count` integer,
	`section_count` integer,
	`coverage_json` text NOT NULL,
	`fact_ids_json` text NOT NULL,
	`fact_bindings_json` text NOT NULL,
	`issues_json` text NOT NULL,
	`warnings_json` text NOT NULL,
	`outcome_candidate` text NOT NULL,
	`assessment_state` text NOT NULL,
	`assessment_hash` text NOT NULL,
	`supersedes_assessment_id` text,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`,`tax_case_id`,`tenant_id`) REFERENCES `tax_case_external_sources`(`id`,`tax_case_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`,`tenant_id`) REFERENCES `personal_tax_source_artifacts`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`content_hash`) REFERENCES `personal_tax_source_artifacts`(`tenant_id`,`content_hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_assessment_id`,`tenant_id`,`tax_case_id`,`source_id`) REFERENCES `tax_case_source_assessments`(`id`,`tenant_id`,`tax_case_id`,`source_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_source_assessment_hashes" CHECK(length("tax_case_source_assessments"."content_hash") = 64 AND "tax_case_source_assessments"."content_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_source_assessments"."assessment_hash") = 64 AND "tax_case_source_assessments"."assessment_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_case_source_assessments"."request_hash") = 64 AND "tax_case_source_assessments"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_tax_case_source_assessment_actor" CHECK("tax_case_source_assessments"."assessor_actor_kind" IN ('HUMAN', 'AGENT') AND length(trim("tax_case_source_assessments"."assessor_actor_id")) > 0),
	CONSTRAINT "chk_tax_case_source_assessment_mode" CHECK("tax_case_source_assessments"."extraction_mode" IN ('MACHINE', 'AGENT_ASSISTED', 'MANUAL')),
	CONSTRAINT "chk_tax_case_source_assessment_kind" CHECK("tax_case_source_assessments"."declared_source_kind" IN ('AIS', 'TIS', 'FORM_26AS', 'OTHER')),
	CONSTRAINT "chk_tax_case_source_assessment_outcome" CHECK("tax_case_source_assessments"."outcome_candidate" IN ('FACTS_PRESENT', 'EMPTY')),
	CONSTRAINT "chk_tax_case_source_assessment_state" CHECK("tax_case_source_assessments"."assessment_state" IN ('DRAFT', 'PROPOSED')),
	CONSTRAINT "chk_tax_case_source_assessment_counts" CHECK((record_count IS NULL OR (typeof(record_count) = 'integer' AND record_count >= 0)) AND (page_count IS NULL OR (typeof(page_count) = 'integer' AND page_count >= 0)) AND (section_count IS NULL OR (typeof(section_count) = 'integer' AND section_count >= 0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_source_assessments_id_scope` ON `tax_case_source_assessments` (`id`,`tenant_id`,`tax_case_id`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_source_assessments_request` ON `tax_case_source_assessments` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_tax_case_source_assessments_source` ON `tax_case_source_assessments` (`tenant_id`,`tax_case_id`,`source_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER `tax_case_source_assessments_no_update` BEFORE UPDATE ON `tax_case_source_assessments` BEGIN SELECT RAISE(ABORT, 'tax case source assessments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `tax_case_source_assessments_no_delete` BEFORE DELETE ON `tax_case_source_assessments` BEGIN SELECT RAISE(ABORT, 'tax case source assessments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `tax_case_source_assessment_events_no_update` BEFORE UPDATE ON `tax_case_source_assessment_events` BEGIN SELECT RAISE(ABORT, 'tax case source assessment events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `tax_case_source_assessment_events_no_delete` BEFORE DELETE ON `tax_case_source_assessment_events` BEGIN SELECT RAISE(ABORT, 'tax case source assessment events are immutable'); END;
