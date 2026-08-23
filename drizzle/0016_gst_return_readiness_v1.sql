-- GST Return Readiness V1: source facts, snapshots, validation, export artifacts, and observations
-- V1 scope: TAX_INVOICE only (ordinary B2B/B2C), no portal JSON, no GSTR-3B, no credit/debit notes

CREATE UNIQUE INDEX `uq_gst_registrations_scope_key` ON `gst_registrations` (`id`,`tenant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sales_invoice_lines_id_tenant_book_set_v1` ON `sales_invoice_lines` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE TABLE `gst_outward_facts` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `book_set_id` text NOT NULL,
  `invoice_id` text NOT NULL,
  `created_at` text NOT NULL,
  `place_of_supply_state_code` text,
  `recipient_registration_category` text,
  `recipient_category_snapshot` text,
  `reverse_charge_applicable` integer DEFAULT 0 NOT NULL,
  `ecommerce_gstin` text,
  `narration` text,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`invoice_id`,`tenant_id`,`book_set_id`) REFERENCES `sales_invoices`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_gst_outward_facts_pos_state` CHECK(`place_of_supply_state_code` IS NULL OR (length(`place_of_supply_state_code`) = 2 AND `place_of_supply_state_code` GLOB '[0-9][0-9]')),
  CONSTRAINT `chk_gst_outward_facts_recipient_category` CHECK(`recipient_registration_category` IS NULL OR `recipient_registration_category` IN ('REGISTERED', 'UNREGISTERED', 'CONSUMER', 'COMPOSITION', 'EXEMPT')),
  CONSTRAINT `chk_gst_outward_facts_reverse_charge` CHECK(typeof(`reverse_charge_applicable`) = 'integer' AND `reverse_charge_applicable` IN (0, 1)),
  CONSTRAINT `chk_gst_outward_facts_ecommerce_gstin` CHECK(`ecommerce_gstin` IS NULL OR length(`ecommerce_gstin`) = 15)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_outward_facts_scope_key` ON `gst_outward_facts` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_outward_facts_invoice` ON `gst_outward_facts` (`invoice_id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_gst_outward_facts_scope` ON `gst_outward_facts` (`tenant_id`,`book_set_id`,`invoice_id`);
--> statement-breakpoint
CREATE TABLE `gst_outward_line_facts` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `book_set_id` text NOT NULL,
  `outward_facts_id` text NOT NULL,
  `invoice_line_id` text NOT NULL,
  `line_number` integer NOT NULL,
  `classification` text,
  `hsn_sac_code` text,
  `quantity_decimal` text,
  `unit_of_measure_code` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`outward_facts_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_outward_facts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`invoice_line_id`,`tenant_id`,`book_set_id`) REFERENCES `sales_invoice_lines`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_gst_line_facts_classification` CHECK(`classification` IS NULL OR `classification` IN ('GOODS', 'SERVICES')),
  CONSTRAINT `chk_gst_line_facts_hsn_sac` CHECK(`hsn_sac_code` IS NULL OR (length(`hsn_sac_code`) >= 4 AND length(`hsn_sac_code`) <= 8)),
  CONSTRAINT `chk_gst_line_facts_line_number` CHECK(typeof(`line_number`) = 'integer' AND `line_number` > 0),
  CONSTRAINT `chk_gst_line_facts_quantity` CHECK(`quantity_decimal` IS NULL OR (typeof(`quantity_decimal`) = 'text' AND length(`quantity_decimal`) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_line_facts_scope_key` ON `gst_outward_line_facts` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_line_facts_line_number` ON `gst_outward_line_facts` (`outward_facts_id`,`line_number`);
--> statement-breakpoint
CREATE INDEX `idx_gst_line_facts_scope` ON `gst_outward_line_facts` (`tenant_id`,`book_set_id`,`outward_facts_id`);
--> statement-breakpoint
CREATE TABLE `gst_returns` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `book_set_id` text NOT NULL,
  `registration_id` text NOT NULL,
  `gstin` text NOT NULL,
  `return_form` text NOT NULL,
  `tax_period_from` text NOT NULL,
  `tax_period_to` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`registration_id`,`tenant_id`) REFERENCES `gst_registrations`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_gst_return_form` CHECK(`return_form` IN ('GSTR1', 'GSTR2', 'GSTR3B')),
  CONSTRAINT `chk_gst_return_period_from` CHECK(length(`tax_period_from`) = 10),
  CONSTRAINT `chk_gst_return_period_to` CHECK(length(`tax_period_to`) = 10),
  CONSTRAINT `chk_gst_return_period_order` CHECK(`tax_period_from` <= `tax_period_to`),
  CONSTRAINT `chk_gst_return_gstin` CHECK(length(`gstin`) = 15)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_returns_scope_key` ON `gst_returns` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_return_registration_period` ON `gst_returns` (`registration_id`,`return_form`,`tax_period_from`,`tax_period_to`);
--> statement-breakpoint
CREATE INDEX `idx_gst_returns_scope_period` ON `gst_returns` (`tenant_id`,`book_set_id`,`registration_id`,`tax_period_from`,`tax_period_to`);
--> statement-breakpoint
CREATE TABLE `gst_return_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `return_id` text NOT NULL,
  `tenant_id` text NOT NULL,
  `book_set_id` text NOT NULL,
  `snapshot_version` integer NOT NULL,
  `prepared_at` text NOT NULL,
  `prepared_by_actor_id` text NOT NULL,
  `request_hash` text NOT NULL,
  `payload_hash` text NOT NULL,
  `source_invoice_ids_json` text NOT NULL,
  `frozen_source_hashes_json` text NOT NULL,
  `summary_facts_json` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`return_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_returns`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_gst_snapshot_version` CHECK(typeof(`snapshot_version`) = 'integer' AND `snapshot_version` >= 1),
  CONSTRAINT `chk_gst_snapshot_hashes` CHECK(length(`request_hash`) = 64 AND length(`payload_hash`) = 64 AND `request_hash` NOT GLOB '*[^0-9a-f]*' AND `payload_hash` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_return_snapshot_scope_key` ON `gst_return_snapshots` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_snapshot_return_version` ON `gst_return_snapshots` (`return_id`,`snapshot_version`);
--> statement-breakpoint
CREATE INDEX `idx_gst_snapshot_scope_return` ON `gst_return_snapshots` (`tenant_id`,`book_set_id`,`return_id`);
--> statement-breakpoint
CREATE TABLE `gst_return_validations` (
  `id` text PRIMARY KEY NOT NULL,
  `snapshot_id` text NOT NULL,
  `return_id` text NOT NULL,
  `tenant_id` text NOT NULL,
  `book_set_id` text NOT NULL,
  `validated_at` text NOT NULL,
  `validated_by_actor_id` text NOT NULL,
  `readiness_status` text NOT NULL,
  `issues_json` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`snapshot_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_return_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`return_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_returns`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_gst_validation_readiness_status` CHECK(`readiness_status` IN ('READY', 'REVIEW_REQUIRED', 'BLOCKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_validation_scope_key` ON `gst_return_validations` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_validation_snapshot` ON `gst_return_validations` (`snapshot_id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_gst_validation_scope_return` ON `gst_return_validations` (`tenant_id`,`book_set_id`,`return_id`,`readiness_status`);
--> statement-breakpoint
CREATE TABLE `gst_return_exports` (
  `id` text PRIMARY KEY NOT NULL,
  `validation_id` text NOT NULL,
  `snapshot_id` text NOT NULL,
  `return_id` text NOT NULL,
  `tenant_id` text NOT NULL,
  `book_set_id` text NOT NULL,
  `exported_at` text NOT NULL,
  `exported_by_actor_id` text NOT NULL,
  `manifest_json` text NOT NULL,
  `manifest_hash` text NOT NULL,
  `artifact_format_version` text NOT NULL,
  `portal_json_status` text NOT NULL,
  `csv_summary_lines_json` text NOT NULL,
  `csv_summary_hash` text NOT NULL,
  `csv_documents_lines_json` text NOT NULL,
  `csv_documents_hash` text NOT NULL,
  `csv_line_details_lines_json` text NOT NULL,
  `csv_line_details_hash` text NOT NULL,
  `csv_tax_component_lines_json` text NOT NULL,
  `csv_tax_component_hash` text NOT NULL,
  `csv_validation_issues_lines_json` text NOT NULL,
  `csv_validation_issues_hash` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`validation_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_return_validations`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`snapshot_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_return_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`return_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_returns`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_gst_export_hashes` CHECK(
    length(`manifest_hash`) = 64 AND
    length(`csv_summary_hash`) = 64 AND
    length(`csv_documents_hash`) = 64 AND
    length(`csv_line_details_hash`) = 64 AND
    length(`csv_tax_component_hash`) = 64 AND
    length(`csv_validation_issues_hash`) = 64 AND
    `manifest_hash` NOT GLOB '*[^0-9a-f]*' AND
    `csv_summary_hash` NOT GLOB '*[^0-9a-f]*' AND
    `csv_documents_hash` NOT GLOB '*[^0-9a-f]*' AND
    `csv_line_details_hash` NOT GLOB '*[^0-9a-f]*' AND
    `csv_tax_component_hash` NOT GLOB '*[^0-9a-f]*' AND
    `csv_validation_issues_hash` NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT `chk_gst_export_portal_json_status` CHECK(`portal_json_status` IN ('SCHEMA_UNPINNED', 'NOT_GENERATED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_export_scope_key` ON `gst_return_exports` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_export_validation` ON `gst_return_exports` (`validation_id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_gst_export_scope_return` ON `gst_return_exports` (`tenant_id`,`book_set_id`,`return_id`);
--> statement-breakpoint
CREATE TABLE `gst_return_observations` (
  `id` text PRIMARY KEY NOT NULL,
  `return_id` text NOT NULL,
  `tenant_id` text NOT NULL,
  `book_set_id` text NOT NULL,
  `recorded_at` text NOT NULL,
  `recorded_by_actor_id` text NOT NULL,
  `observation_type` text NOT NULL,
  `external_reference` text,
  `evidence_id` text,
  `narration` text,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`return_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_returns`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_gst_observation_type` CHECK(`observation_type` IN ('USER_MARKED_PORTAL_UPLOADED', 'PORTAL_ERROR', 'PORTAL_PROCESSED', 'USER_MARKED_SUBMITTED', 'ACKNOWLEDGED', 'REJECTED')),
  CONSTRAINT `chk_gst_observation_evidence_required` CHECK((`observation_type` IN ('USER_MARKED_SUBMITTED', 'ACKNOWLEDGED') AND `evidence_id` IS NOT NULL) OR `observation_type` NOT IN ('USER_MARKED_SUBMITTED', 'ACKNOWLEDGED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_observation_scope_key` ON `gst_return_observations` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_gst_observation_scope_return` ON `gst_return_observations` (`tenant_id`,`book_set_id`,`return_id`,`observation_type`);
--> statement-breakpoint
CREATE INDEX `idx_gst_observation_recorded_at` ON `gst_return_observations` (`tenant_id`,`book_set_id`,`return_id`,`recorded_at`);
--> statement-breakpoint
CREATE TRIGGER `gst_outward_facts_no_update` BEFORE UPDATE ON `gst_outward_facts` BEGIN SELECT RAISE(ABORT, 'gst outward facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_outward_facts_no_delete` BEFORE DELETE ON `gst_outward_facts` BEGIN SELECT RAISE(ABORT, 'gst outward facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_line_facts_no_update` BEFORE UPDATE ON `gst_outward_line_facts` BEGIN SELECT RAISE(ABORT, 'gst line facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_line_facts_no_delete` BEFORE DELETE ON `gst_outward_line_facts` BEGIN SELECT RAISE(ABORT, 'gst line facts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_snapshots_no_update` BEFORE UPDATE ON `gst_return_snapshots` BEGIN SELECT RAISE(ABORT, 'gst return snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_snapshots_no_delete` BEFORE DELETE ON `gst_return_snapshots` BEGIN SELECT RAISE(ABORT, 'gst return snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_validations_no_update` BEFORE UPDATE ON `gst_return_validations` BEGIN SELECT RAISE(ABORT, 'gst return validations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_validations_no_delete` BEFORE DELETE ON `gst_return_validations` BEGIN SELECT RAISE(ABORT, 'gst return validations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_exports_no_update` BEFORE UPDATE ON `gst_return_exports` BEGIN SELECT RAISE(ABORT, 'gst return exports are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_exports_no_delete` BEFORE DELETE ON `gst_return_exports` BEGIN SELECT RAISE(ABORT, 'gst return exports are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_observations_no_update` BEFORE UPDATE ON `gst_return_observations` BEGIN SELECT RAISE(ABORT, 'gst return observations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_observations_no_delete` BEFORE DELETE ON `gst_return_observations` BEGIN SELECT RAISE(ABORT, 'gst return observations are immutable'); END;
