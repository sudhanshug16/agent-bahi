CREATE TABLE `personal_tax_source_artifacts` (
	`tenant_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`id` text NOT NULL,
	`bytes` blob NOT NULL,
	`byte_size` integer NOT NULL,
	`media_type` text NOT NULL,
	`original_filename` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `content_hash`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_personal_tax_source_artifact_hash" CHECK(length("personal_tax_source_artifacts"."content_hash") = 64 AND "personal_tax_source_artifacts"."content_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_personal_tax_source_artifact_size" CHECK(typeof("personal_tax_source_artifacts"."byte_size") = 'integer' AND "personal_tax_source_artifacts"."byte_size" > 0),
	CONSTRAINT "chk_personal_tax_source_artifact_metadata" CHECK(length(trim("personal_tax_source_artifacts"."media_type")) > 0 AND length(trim("personal_tax_source_artifacts"."original_filename")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_personal_tax_source_artifacts_id_scope` ON `personal_tax_source_artifacts` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_personal_tax_source_artifacts_tenant` ON `personal_tax_source_artifacts` (`tenant_id`,`created_at`,`content_hash`);--> statement-breakpoint
CREATE TABLE `tax_case_external_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_period` text,
	`source_as_of` text,
	`parser_identity` text NOT NULL,
	`parser_version` text NOT NULL,
	`parser_status` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tax_case_id`,`tenant_id`) REFERENCES `tax_cases`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_external_source_kind" CHECK("tax_case_external_sources"."source_kind" IN ('AIS', 'TIS', 'FORM_26AS', 'OTHER')),
	CONSTRAINT "chk_tax_case_external_source_parser_status" CHECK("tax_case_external_sources"."parser_status" IN ('UNPARSED', 'UNSUPPORTED', 'PARSED')),
	CONSTRAINT "chk_tax_case_external_source_status" CHECK("tax_case_external_sources"."status" IN ('STORED', 'INCOMPLETE', 'READY')),
	CONSTRAINT "chk_tax_case_external_source_parser_identity" CHECK(length(trim("tax_case_external_sources"."parser_identity")) > 0 AND length(trim("tax_case_external_sources"."parser_version")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_external_sources_id_scope` ON `tax_case_external_sources` (`id`,`tax_case_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_tax_case_external_sources_case` ON `tax_case_external_sources` (`tenant_id`,`tax_case_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `tax_case_source_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`source_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`,`tax_case_id`,`tenant_id`) REFERENCES `tax_case_external_sources`(`id`,`tax_case_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`,`tenant_id`) REFERENCES `personal_tax_source_artifacts`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`content_hash`) REFERENCES `personal_tax_source_artifacts`(`tenant_id`,`content_hash`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_source_artifact_hash" CHECK(length("tax_case_source_artifacts"."content_hash") = 64 AND "tax_case_source_artifacts"."content_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_source_artifacts_source_hash` ON `tax_case_source_artifacts` (`source_id`,`tenant_id`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_source_artifacts_id_scope` ON `tax_case_source_artifacts` (`id`,`tax_case_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_tax_case_source_artifacts_case` ON `tax_case_source_artifacts` (`tenant_id`,`tax_case_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER `personal_tax_source_artifacts_no_update` BEFORE UPDATE ON `personal_tax_source_artifacts` BEGIN SELECT RAISE(ABORT, 'personal tax source artifacts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `personal_tax_source_artifacts_no_delete` BEFORE DELETE ON `personal_tax_source_artifacts` BEGIN SELECT RAISE(ABORT, 'personal tax source artifacts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_external_sources_no_update` BEFORE UPDATE ON `tax_case_external_sources` BEGIN SELECT RAISE(ABORT, 'tax case external sources are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_external_sources_no_delete` BEFORE DELETE ON `tax_case_external_sources` BEGIN SELECT RAISE(ABORT, 'tax case external sources are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_source_artifacts_no_update` BEFORE UPDATE ON `tax_case_source_artifacts` BEGIN SELECT RAISE(ABORT, 'tax case source artifact links are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_source_artifacts_no_delete` BEFORE DELETE ON `tax_case_source_artifacts` BEGIN SELECT RAISE(ABORT, 'tax case source artifact links are immutable'); END;
