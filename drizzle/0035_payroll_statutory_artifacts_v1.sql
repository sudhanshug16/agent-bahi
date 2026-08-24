CREATE TABLE `payroll_statutory_packs` (
 `id` text PRIMARY KEY NOT NULL, `semantic_kind` text NOT NULL, `jurisdiction` text NOT NULL, `applicable_from` text NOT NULL, `applicable_to` text, `official_form_code` text NOT NULL, `official_form_version` text NOT NULL, `authority_reference` text NOT NULL, `validator_version` text NOT NULL, `validation_schema_json` text NOT NULL, `mapping_spec_json` text NOT NULL, `export_format` text NOT NULL, `canonical_hash` text NOT NULL, `supersedes_pack_id` text, `created_at` text NOT NULL, `created_by_actor_kind` text NOT NULL, `created_by_actor_id` text NOT NULL,
 FOREIGN KEY (`supersedes_pack_id`) REFERENCES `payroll_statutory_packs`(`id`) ON UPDATE no action ON DELETE no action,
 CONSTRAINT `chk_payroll_statutory_packs_kind` CHECK(`semantic_kind` IN ('SALARY_TDS_QUARTERLY_STATEMENT','SALARY_TDS_ANNUAL_CERTIFICATE')),
 CONSTRAINT `chk_payroll_statutory_packs_jurisdiction` CHECK(`jurisdiction` = 'IN'),
 CONSTRAINT `chk_payroll_statutory_packs_format` CHECK(`export_format` IN ('JSON','CSV','TEXT')),
 CONSTRAINT `chk_payroll_statutory_packs_dates` CHECK(`applicable_to` IS NULL OR `applicable_to` >= `applicable_from`),
 CONSTRAINT `chk_payroll_statutory_packs_hash` CHECK(length(`canonical_hash`) = 64 AND `canonical_hash` NOT GLOB '*[^0-9a-f]*'),
 CONSTRAINT `chk_payroll_statutory_packs_actor` CHECK(`created_by_actor_kind` IN ('AGENT','HUMAN') AND length(trim(`created_by_actor_id`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_statutory_packs_hash` ON `payroll_statutory_packs` (`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_statutory_packs_identity` ON `payroll_statutory_packs` (`semantic_kind`,`official_form_code`,`official_form_version`,`applicable_from`);--> statement-breakpoint
CREATE INDEX `idx_payroll_statutory_packs_effective` ON `payroll_statutory_packs` (`semantic_kind`,`applicable_from`,`applicable_to`);--> statement-breakpoint
CREATE TABLE `payroll_statutory_pack_events` (
 `id` text PRIMARY KEY NOT NULL, `pack_id` text NOT NULL, `event_type` text NOT NULL, `actor_kind` text NOT NULL, `actor_id` text NOT NULL, `reason` text NOT NULL, `expected_pack_hash` text NOT NULL, `request_id` text NOT NULL, `request_hash` text NOT NULL, `created_at` text NOT NULL,
 FOREIGN KEY (`pack_id`) REFERENCES `payroll_statutory_packs`(`id`) ON UPDATE no action ON DELETE no action,
 CONSTRAINT `chk_payroll_statutory_pack_event_type` CHECK(`event_type` IN ('REGISTERED','HUMAN_VERIFIED','REJECTED','SUPERSEDED')),
 CONSTRAINT `chk_payroll_statutory_pack_event_actor` CHECK(`actor_kind` IN ('AGENT','HUMAN') AND length(trim(`actor_id`)) > 0 AND (`event_type` IN ('REGISTERED','SUPERSEDED') OR `actor_kind` = 'HUMAN')),
 CONSTRAINT `chk_payroll_statutory_pack_event_hashes` CHECK(length(`expected_pack_hash`) = 64 AND `expected_pack_hash` NOT GLOB '*[^0-9a-f]*' AND length(`request_hash`) = 64 AND `request_hash` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_statutory_pack_events_request` ON `payroll_statutory_pack_events` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_statutory_pack_events_pack` ON `payroll_statutory_pack_events` (`pack_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `payroll_statutory_artifacts` (
 `id` text PRIMARY KEY NOT NULL, `tenant_id` text NOT NULL, `book_set_id` text NOT NULL, `semantic_kind` text NOT NULL, `financial_year` text NOT NULL, `quarter` text, `employee_id` text, `schema_pack_id` text NOT NULL, `schema_pack_hash` text NOT NULL, `source_model_hash` text NOT NULL, `neutral_content` text NOT NULL, `government_content` text NOT NULL, `neutral_content_hash` text NOT NULL, `government_content_hash` text NOT NULL, `content_byte_length` integer NOT NULL, `content_type` text NOT NULL, `bindings_json` text NOT NULL, `created_at` text NOT NULL, `created_by_actor_kind` text NOT NULL, `created_by_actor_id` text NOT NULL, `request_id` text NOT NULL, `request_hash` text NOT NULL,
 FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action, FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action, FOREIGN KEY (`employee_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_employees`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action, FOREIGN KEY (`schema_pack_id`) REFERENCES `payroll_statutory_packs`(`id`) ON UPDATE no action ON DELETE no action,
 CONSTRAINT `chk_payroll_statutory_artifacts_kind` CHECK(`semantic_kind` IN ('SALARY_TDS_QUARTERLY_STATEMENT','SALARY_TDS_ANNUAL_CERTIFICATE')),
 CONSTRAINT `chk_payroll_statutory_artifacts_quarter` CHECK(`quarter` IS NULL OR `quarter` IN ('Q1','Q2','Q3','Q4')),
 CONSTRAINT `chk_payroll_statutory_artifacts_hashes` CHECK(length(`schema_pack_hash`) = 64 AND `schema_pack_hash` NOT GLOB '*[^0-9a-f]*' AND length(`source_model_hash`) = 64 AND `source_model_hash` NOT GLOB '*[^0-9a-f]*' AND length(`neutral_content_hash`) = 64 AND `neutral_content_hash` NOT GLOB '*[^0-9a-f]*' AND length(`government_content_hash`) = 64 AND `government_content_hash` NOT GLOB '*[^0-9a-f]*' AND length(`request_hash`) = 64 AND `request_hash` NOT GLOB '*[^0-9a-f]*'),
 CONSTRAINT `chk_payroll_statutory_artifacts_actor` CHECK(`created_by_actor_kind` IN ('AGENT','HUMAN') AND length(trim(`created_by_actor_id`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_statutory_artifacts_scope_hash` ON `payroll_statutory_artifacts` (`tenant_id`,`book_set_id`,`semantic_kind`,`financial_year`,`quarter`,`employee_id`,`government_content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_statutory_artifacts_request` ON `payroll_statutory_artifacts` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_statutory_artifacts_id_scope` ON `payroll_statutory_artifacts` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_statutory_artifacts_scope` ON `payroll_statutory_artifacts` (`tenant_id`,`book_set_id`,`semantic_kind`,`financial_year`,`quarter`,`employee_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payroll_statutory_validation_runs` (
 `id` text PRIMARY KEY NOT NULL, `tenant_id` text NOT NULL, `book_set_id` text NOT NULL, `artifact_id` text NOT NULL, `artifact_hash` text NOT NULL, `schema_pack_hash` text NOT NULL, `validation_hash` text NOT NULL, `status` text NOT NULL, `diagnostics_json` text NOT NULL, `created_at` text NOT NULL, `created_by_actor_kind` text NOT NULL, `created_by_actor_id` text NOT NULL, `request_id` text NOT NULL, `request_hash` text NOT NULL,
 FOREIGN KEY (`artifact_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_statutory_artifacts`(`id`,`tenant_id`,`book_set_id`), CONSTRAINT `chk_payroll_statutory_validation_status` CHECK(`status` IN ('LOCAL_VALID','LOCAL_INVALID')), CONSTRAINT `chk_payroll_statutory_validation_hashes` CHECK(length(`artifact_hash`) = 64 AND `artifact_hash` NOT GLOB '*[^0-9a-f]*' AND length(`schema_pack_hash`) = 64 AND `schema_pack_hash` NOT GLOB '*[^0-9a-f]*' AND length(`validation_hash`) = 64 AND `validation_hash` NOT GLOB '*[^0-9a-f]*' AND length(`request_hash`) = 64 AND `request_hash` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_statutory_validation_request` ON `payroll_statutory_validation_runs` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_statutory_validation_artifact` ON `payroll_statutory_validation_runs` (`tenant_id`,`book_set_id`,`artifact_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payroll_statutory_export_activities` (
 `id` text PRIMARY KEY NOT NULL, `tenant_id` text NOT NULL, `book_set_id` text NOT NULL, `artifact_id` text NOT NULL, `artifact_hash` text NOT NULL, `validation_hash` text NOT NULL, `actor_kind` text NOT NULL, `actor_id` text NOT NULL, `request_id` text NOT NULL, `request_hash` text NOT NULL, `created_at` text NOT NULL,
 FOREIGN KEY (`artifact_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_statutory_artifacts`(`id`,`tenant_id`,`book_set_id`), CONSTRAINT `chk_payroll_statutory_export_actor` CHECK(`actor_kind` = 'HUMAN' AND length(trim(`actor_id`)) > 0), CONSTRAINT `chk_payroll_statutory_export_hashes` CHECK(length(`artifact_hash`) = 64 AND `artifact_hash` NOT GLOB '*[^0-9a-f]*' AND length(`validation_hash`) = 64 AND `validation_hash` NOT GLOB '*[^0-9a-f]*' AND length(`request_hash`) = 64 AND `request_hash` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_statutory_export_request` ON `payroll_statutory_export_activities` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_statutory_export_artifact` ON `payroll_statutory_export_activities` (`tenant_id`,`book_set_id`,`artifact_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `payroll_statutory_packs_no_update` BEFORE UPDATE ON `payroll_statutory_packs` BEGIN SELECT RAISE(ABORT, 'payroll statutory packs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `payroll_statutory_packs_no_delete` BEFORE DELETE ON `payroll_statutory_packs` BEGIN SELECT RAISE(ABORT, 'payroll statutory packs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `payroll_statutory_pack_events_no_update` BEFORE UPDATE ON `payroll_statutory_pack_events` BEGIN SELECT RAISE(ABORT, 'payroll statutory pack events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `payroll_statutory_pack_events_no_delete` BEFORE DELETE ON `payroll_statutory_pack_events` BEGIN SELECT RAISE(ABORT, 'payroll statutory pack events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `payroll_statutory_artifacts_no_update` BEFORE UPDATE ON `payroll_statutory_artifacts` BEGIN SELECT RAISE(ABORT, 'payroll statutory artifacts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `payroll_statutory_artifacts_no_delete` BEFORE DELETE ON `payroll_statutory_artifacts` BEGIN SELECT RAISE(ABORT, 'payroll statutory artifacts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `payroll_statutory_validation_no_update` BEFORE UPDATE ON `payroll_statutory_validation_runs` BEGIN SELECT RAISE(ABORT, 'payroll statutory validation runs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `payroll_statutory_validation_no_delete` BEFORE DELETE ON `payroll_statutory_validation_runs` BEGIN SELECT RAISE(ABORT, 'payroll statutory validation runs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `payroll_statutory_export_no_update` BEFORE UPDATE ON `payroll_statutory_export_activities` BEGIN SELECT RAISE(ABORT, 'payroll statutory export activities are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `payroll_statutory_export_no_delete` BEFORE DELETE ON `payroll_statutory_export_activities` BEGIN SELECT RAISE(ABORT, 'payroll statutory export activities are immutable'); END;
