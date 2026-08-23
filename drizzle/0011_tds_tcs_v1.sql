PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `__agent_bahi_vendor_bills_backup` AS SELECT * FROM `vendor_bills`;
--> statement-breakpoint
CREATE TABLE `__agent_bahi_vendor_bill_lines_backup` AS SELECT * FROM `vendor_bill_lines`;
--> statement-breakpoint
CREATE TABLE `__agent_bahi_vendor_payment_allocations_backup` AS SELECT * FROM `vendor_payment_allocations`;
--> statement-breakpoint
CREATE TABLE `__agent_bahi_gst_tax_snapshots_backup` AS SELECT * FROM `gst_tax_snapshots`;
--> statement-breakpoint
CREATE TABLE `__agent_bahi_gst_tax_components_backup` AS SELECT * FROM `gst_tax_components`;
--> statement-breakpoint
DROP TABLE `gst_tax_components`;
--> statement-breakpoint
DROP TABLE `gst_tax_snapshots`;
--> statement-breakpoint
DROP TABLE `vendor_payment_allocations`;
--> statement-breakpoint
DROP TABLE `vendor_bill_lines`;
--> statement-breakpoint
DROP TABLE `vendor_bills`;
--> statement-breakpoint
CREATE TABLE `vendor_bills` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`bill_number` text NOT NULL,
	`vendor_id` text NOT NULL,
	`bill_date` text NOT NULL,
	`due_date` text,
	`narration` text,
	`status` text NOT NULL,
	`total_minor` integer NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`payable_account_id` text,
	`posted_journal_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`posted_at` text,
	`gst_input_json` text,
	`withholding_minor` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`,`tenant_id`,`book_set_id`) REFERENCES `parties`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payable_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_vendor_bill_total" CHECK(typeof("vendor_bills"."total_minor") = 'integer' AND "vendor_bills"."total_minor" > 0),
	CONSTRAINT "chk_vendor_bill_paid" CHECK(typeof("vendor_bills"."paid_minor") = 'integer' AND "vendor_bills"."paid_minor" >= 0 AND "vendor_bills"."paid_minor" <= "vendor_bills"."total_minor"),
	CONSTRAINT "chk_vendor_bill_withholding" CHECK(typeof("vendor_bills"."withholding_minor") = 'integer' AND "vendor_bills"."withholding_minor" >= 0 AND "vendor_bills"."withholding_minor" <= "vendor_bills"."total_minor" - "vendor_bills"."paid_minor"),
	CONSTRAINT "chk_vendor_bill_status" CHECK("vendor_bills"."status" IN ('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID')),
	CONSTRAINT "chk_vendor_bill_status_fields" CHECK(("vendor_bills"."status" = 'DRAFT' AND "vendor_bills"."payable_account_id" IS NULL AND "vendor_bills"."posted_journal_id" IS NULL AND "vendor_bills"."posted_at" IS NULL AND "vendor_bills"."paid_minor" = 0 AND "vendor_bills"."withholding_minor" = 0) OR ("vendor_bills"."status" IN ('POSTED', 'PARTIALLY_PAID', 'PAID') AND "vendor_bills"."payable_account_id" IS NOT NULL AND "vendor_bills"."posted_journal_id" IS NOT NULL AND "vendor_bills"."posted_at" IS NOT NULL)),
	CONSTRAINT "chk_vendor_bill_paid_status" CHECK(("vendor_bills"."status" = 'POSTED' AND "vendor_bills"."paid_minor" + "vendor_bills"."withholding_minor" = 0) OR ("vendor_bills"."status" = 'PARTIALLY_PAID' AND "vendor_bills"."paid_minor" + "vendor_bills"."withholding_minor" > 0 AND "vendor_bills"."paid_minor" + "vendor_bills"."withholding_minor" < "vendor_bills"."total_minor") OR ("vendor_bills"."status" = 'PAID' AND "vendor_bills"."paid_minor" + "vendor_bills"."withholding_minor" = "vendor_bills"."total_minor") OR "vendor_bills"."status" = 'DRAFT')
);
--> statement-breakpoint
INSERT INTO `vendor_bills` (`id`, `tenant_id`, `book_set_id`, `bill_number`, `vendor_id`, `bill_date`, `due_date`, `narration`, `status`, `total_minor`, `paid_minor`, `payable_account_id`, `posted_journal_id`, `created_at`, `updated_at`, `posted_at`, `gst_input_json`, `withholding_minor`) SELECT `id`, `tenant_id`, `book_set_id`, `bill_number`, `vendor_id`, `bill_date`, `due_date`, `narration`, `status`, `total_minor`, `paid_minor`, `payable_account_id`, `posted_journal_id`, `created_at`, `updated_at`, `posted_at`, `gst_input_json`, 0 FROM `__agent_bahi_vendor_bills_backup`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vendor_bill_number_scope` ON `vendor_bills` (`tenant_id`,`book_set_id`,`bill_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vendor_bills_id_tenant_book_set_v7` ON `vendor_bills` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_vendor_bills_scope_status_v7` ON `vendor_bills` (`tenant_id`,`book_set_id`,`status`,`bill_date`,`id`);
--> statement-breakpoint
CREATE TABLE `vendor_bill_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`bill_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`description` text NOT NULL,
	`expense_account_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	FOREIGN KEY (`bill_id`,`tenant_id`,`book_set_id`) REFERENCES `vendor_bills`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`expense_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_vendor_bill_line_number" CHECK(typeof("vendor_bill_lines"."line_number") = 'integer' AND "vendor_bill_lines"."line_number" > 0),
	CONSTRAINT "chk_vendor_bill_line_description" CHECK(length("vendor_bill_lines"."description") > 0),
	CONSTRAINT "chk_vendor_bill_line_amount" CHECK(typeof("vendor_bill_lines"."amount_minor") = 'integer' AND "vendor_bill_lines"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vendor_bill_line_number` ON `vendor_bill_lines` (`bill_id`,`line_number`);
--> statement-breakpoint
CREATE INDEX `idx_vendor_bill_lines_bill_v7` ON `vendor_bill_lines` (`tenant_id`,`book_set_id`,`bill_id`,`line_number`);
--> statement-breakpoint
INSERT INTO `vendor_bill_lines` SELECT * FROM `__agent_bahi_vendor_bill_lines_backup`;
--> statement-breakpoint
CREATE TABLE `vendor_payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`bill_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	FOREIGN KEY (`payment_id`,`tenant_id`,`book_set_id`) REFERENCES `vendor_payments`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`,`tenant_id`,`book_set_id`) REFERENCES `vendor_bills`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_vendor_payment_allocation_amount" CHECK(typeof("vendor_payment_allocations"."amount_minor") = 'integer' AND "vendor_payment_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vendor_payment_allocation_bill` ON `vendor_payment_allocations` (`payment_id`,`bill_id`);
--> statement-breakpoint
CREATE INDEX `idx_vendor_payment_allocations_bill_v7` ON `vendor_payment_allocations` (`tenant_id`,`book_set_id`,`bill_id`);
--> statement-breakpoint
INSERT INTO `vendor_payment_allocations` SELECT * FROM `__agent_bahi_vendor_payment_allocations_backup`;
--> statement-breakpoint
CREATE TABLE `gst_tax_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`document_type` text NOT NULL,
	`sales_invoice_id` text,
	`vendor_bill_id` text,
	`seller_registration_id` text,
	`buyer_profile_id` text,
	`seller_gstin` text NOT NULL,
	`seller_state_code` text NOT NULL,
	`buyer_gstin` text,
	`buyer_treatment` text NOT NULL,
	`buyer_state_code` text NOT NULL,
	`local_component` text,
	`geometry` text NOT NULL,
	`rounding_policy` text NOT NULL,
	`taxable_minor` integer NOT NULL,
	`tax_minor` integer NOT NULL,
	`gross_minor` integer NOT NULL,
	`itc_treatment` text,
	`risk_flags_json` text NOT NULL,
	`evidence_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sales_invoice_id`,`tenant_id`,`book_set_id`) REFERENCES `sales_invoices`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_bill_id`,`tenant_id`,`book_set_id`) REFERENCES `vendor_bills`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_gst_snapshot_document_type" CHECK("gst_tax_snapshots"."document_type" IN ('SALE', 'PURCHASE')),
	CONSTRAINT "chk_gst_snapshot_geometry" CHECK("gst_tax_snapshots"."geometry" IN ('INTRA_STATE', 'INTER_STATE')),
	CONSTRAINT "chk_gst_snapshot_buyer_treatment" CHECK("gst_tax_snapshots"."buyer_treatment" IN ('REGISTERED', 'UNREGISTERED', 'CONSUMER')),
	CONSTRAINT "chk_gst_snapshot_local_component" CHECK("gst_tax_snapshots"."local_component" IS NULL OR "gst_tax_snapshots"."local_component" IN ('SGST', 'UTGST')),
	CONSTRAINT "chk_gst_snapshot_amounts" CHECK(typeof("gst_tax_snapshots"."taxable_minor") = 'integer' AND "gst_tax_snapshots"."taxable_minor" > 0 AND typeof("gst_tax_snapshots"."tax_minor") = 'integer' AND "gst_tax_snapshots"."tax_minor" >= 0 AND typeof("gst_tax_snapshots"."gross_minor") = 'integer' AND "gst_tax_snapshots"."gross_minor" = "gst_tax_snapshots"."taxable_minor" + "gst_tax_snapshots"."tax_minor"),
	CONSTRAINT "chk_gst_snapshot_itc" CHECK("gst_tax_snapshots"."itc_treatment" IS NULL OR "gst_tax_snapshots"."itc_treatment" IN ('ELIGIBLE', 'INELIGIBLE', 'PENDING_REVIEW'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_snapshot_sales_invoice` ON `gst_tax_snapshots` (`sales_invoice_id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_snapshot_vendor_bill` ON `gst_tax_snapshots` (`vendor_bill_id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_snapshot_scope_key` ON `gst_tax_snapshots` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_gst_snapshots_register` ON `gst_tax_snapshots` (`tenant_id`,`book_set_id`,`document_type`,`created_at`,`id`);
--> statement-breakpoint
INSERT INTO `gst_tax_snapshots` SELECT * FROM `__agent_bahi_gst_tax_snapshots_backup`;
--> statement-breakpoint
CREATE TABLE `gst_tax_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`document_line_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`classification` text NOT NULL,
	`component` text NOT NULL,
	`taxable_minor` integer NOT NULL,
	`rate_bps` integer NOT NULL,
	`tax_minor` integer NOT NULL,
	`account_id` text,
	`evidence_json` text NOT NULL,
	FOREIGN KEY (`snapshot_id`,`tenant_id`,`book_set_id`) REFERENCES `gst_tax_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_gst_tax_component_component" CHECK("gst_tax_components"."component" IN ('CGST', 'SGST', 'UTGST', 'IGST')),
	CONSTRAINT "chk_gst_tax_component_amounts" CHECK(typeof("gst_tax_components"."taxable_minor") = 'integer' AND "gst_tax_components"."taxable_minor" > 0 AND typeof("gst_tax_components"."rate_bps") = 'integer' AND "gst_tax_components"."rate_bps" >= 0 AND typeof("gst_tax_components"."tax_minor") = 'integer' AND "gst_tax_components"."tax_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_gst_tax_components_snapshot` ON `gst_tax_components` (`tenant_id`,`book_set_id`,`snapshot_id`,`line_number`,`component`);
--> statement-breakpoint
INSERT INTO `gst_tax_components` SELECT * FROM `__agent_bahi_gst_tax_components_backup`;
--> statement-breakpoint
DROP TABLE `__agent_bahi_gst_tax_components_backup`;
--> statement-breakpoint
DROP TABLE `__agent_bahi_gst_tax_snapshots_backup`;
--> statement-breakpoint
DROP TABLE `__agent_bahi_vendor_payment_allocations_backup`;
--> statement-breakpoint
DROP TABLE `__agent_bahi_vendor_bill_lines_backup`;
--> statement-breakpoint
DROP TABLE `__agent_bahi_vendor_bills_backup`;
--> statement-breakpoint
CREATE TRIGGER `vendor_bills_no_delete_posted` BEFORE DELETE ON `vendor_bills`
WHEN OLD.status <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'posted vendor bills are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_lines_no_update` BEFORE UPDATE ON `vendor_bill_lines`
BEGIN SELECT RAISE(ABORT, 'vendor bill lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bill_lines_no_delete` BEFORE DELETE ON `vendor_bill_lines`
BEGIN SELECT RAISE(ABORT, 'vendor bill lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `vendor_payment_allocations_no_update` BEFORE UPDATE ON `vendor_payment_allocations`
BEGIN SELECT RAISE(ABORT, 'vendor payment allocations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `vendor_payment_allocations_no_delete` BEFORE DELETE ON `vendor_payment_allocations`
BEGIN SELECT RAISE(ABORT, 'vendor payment allocations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_tax_snapshots_no_update` BEFORE UPDATE ON `gst_tax_snapshots`
BEGIN SELECT RAISE(ABORT, 'GST tax snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_tax_snapshots_no_delete` BEFORE DELETE ON `gst_tax_snapshots`
BEGIN SELECT RAISE(ABORT, 'GST tax snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_tax_components_no_update` BEFORE UPDATE ON `gst_tax_components`
BEGIN SELECT RAISE(ABORT, 'GST tax components are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_tax_components_no_delete` BEFORE DELETE ON `gst_tax_components`
BEGIN SELECT RAISE(ABORT, 'GST tax components are immutable'); END;
--> statement-breakpoint
CREATE TABLE `party_tax_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`party_id` text NOT NULL,
	`residency` text NOT NULL,
	`pan` text,
	`verification_status` text NOT NULL,
	`evidence_reference` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`,`tenant_id`,`book_set_id`) REFERENCES `parties`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_party_tax_profile_residency" CHECK("party_tax_profiles"."residency" IN ('RESIDENT', 'NON_RESIDENT')),
	CONSTRAINT "chk_party_tax_profile_status" CHECK("party_tax_profiles"."verification_status" IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
	CONSTRAINT "chk_party_tax_profile_pan" CHECK("party_tax_profiles"."pan" IS NULL OR "party_tax_profiles"."pan" GLOB '[A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z]'),
	CONSTRAINT "chk_party_tax_profile_evidence" CHECK("party_tax_profiles"."verification_status" = 'UNVERIFIED' OR length(COALESCE("party_tax_profiles"."evidence_reference", '')) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_party_tax_profiles_scope_key` ON `party_tax_profiles` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_party_tax_profiles_effective` ON `party_tax_profiles` (`tenant_id`,`book_set_id`,`party_id`,`effective_from`,`id`);--> statement-breakpoint
CREATE TABLE `tax_rule_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_kind` text NOT NULL,
	`source_url` text NOT NULL,
	`source_document` text NOT NULL,
	`source_version` text NOT NULL,
	`section_reference` text NOT NULL,
	`table_reference` text,
	`category_code` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`event_timing` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`threshold_minor` integer,
	`applicability_facts_json` text NOT NULL,
	`tan_required` integer NOT NULL,
	`tan_exception_allowed` integer NOT NULL,
	`statement_route` text NOT NULL,
	`statement_form` text NOT NULL,
	`certificate_form` text,
	`rounding_mode` text NOT NULL,
	`source_verified` integer NOT NULL,
	`canonical_facts_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_rule_snapshot_kind" CHECK("tax_rule_snapshots"."tax_kind" IN ('TDS', 'TCS')),
	CONSTRAINT "chk_tax_rule_snapshot_timing" CHECK("tax_rule_snapshots"."event_timing" IN ('CREDIT', 'PAYMENT')),
	CONSTRAINT "chk_tax_rule_snapshot_rate" CHECK(typeof("tax_rule_snapshots"."rate_bps") = 'integer' AND "tax_rule_snapshots"."rate_bps" >= 0 AND "tax_rule_snapshots"."rate_bps" <= 10000),
	CONSTRAINT "chk_tax_rule_snapshot_threshold" CHECK("tax_rule_snapshots"."threshold_minor" IS NULL OR (typeof("tax_rule_snapshots"."threshold_minor") = 'integer' AND "tax_rule_snapshots"."threshold_minor" >= 0)),
	CONSTRAINT "chk_tax_rule_snapshot_rounding" CHECK("tax_rule_snapshots"."rounding_mode" IN ('HALF_UP')),
	CONSTRAINT "chk_tax_rule_snapshot_source" CHECK("tax_rule_snapshots"."source_url" GLOB 'https://*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_rule_snapshots_scope_key` ON `tax_rule_snapshots` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_tax_rule_snapshots_effective` ON `tax_rule_snapshots` (`tenant_id`,`tax_kind`,`category_code`,`effective_from`,`id`);--> statement-breakpoint
CREATE TABLE `tenant_deductor_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`pan` text,
	`tan` text,
	`verification_status` text NOT NULL,
	`evidence_reference` text,
	`tan_exception_fact` text,
	`tan_exception_reason` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tenant_deductor_profile_status" CHECK("tenant_deductor_profiles"."verification_status" IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
	CONSTRAINT "chk_tenant_deductor_profile_pan" CHECK("tenant_deductor_profiles"."pan" IS NULL OR "tenant_deductor_profiles"."pan" GLOB '[A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z]'),
	CONSTRAINT "chk_tenant_deductor_profile_tan" CHECK("tenant_deductor_profiles"."tan" IS NULL OR "tenant_deductor_profiles"."tan" GLOB '[A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][A-Z]'),
	CONSTRAINT "chk_tenant_deductor_profile_evidence" CHECK("tenant_deductor_profiles"."verification_status" = 'UNVERIFIED' OR length(COALESCE("tenant_deductor_profiles"."evidence_reference", '')) > 0),
	CONSTRAINT "chk_tenant_deductor_profile_tan_exception" CHECK(("tenant_deductor_profiles"."tan_exception_fact" IS NULL AND "tenant_deductor_profiles"."tan_exception_reason" IS NULL) OR ("tenant_deductor_profiles"."tan_exception_fact" IS NOT NULL AND length("tenant_deductor_profiles"."tan_exception_fact") > 0 AND "tenant_deductor_profiles"."tan_exception_reason" IS NOT NULL AND length("tenant_deductor_profiles"."tan_exception_reason") > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_deductor_profiles_scope_key` ON `tenant_deductor_profiles` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_tenant_deductor_profiles_effective` ON `tenant_deductor_profiles` (`tenant_id`,`effective_from`,`id`);--> statement-breakpoint
CREATE TABLE `withholding_compliance_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`tax_kind` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`state` text NOT NULL,
	`government_acknowledgement` text,
	`evidence_reference` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_case_kind" CHECK("withholding_compliance_cases"."tax_kind" IN ('TDS', 'TCS')),
	CONSTRAINT "chk_withholding_case_state" CHECK("withholding_compliance_cases"."state" IN ('PREPARED', 'EXPORTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED')),
	CONSTRAINT "chk_withholding_case_ack" CHECK("withholding_compliance_cases"."state" NOT IN ('SUBMITTED', 'ACCEPTED') OR (length(COALESCE("withholding_compliance_cases"."government_acknowledgement", '')) > 0 AND length(COALESCE("withholding_compliance_cases"."evidence_reference", '')) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_withholding_compliance_case_period` ON `withholding_compliance_cases` (`tenant_id`,`book_set_id`,`tax_kind`,`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `withholding_deposit_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`deposit_id` text NOT NULL,
	`event_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`deposit_id`,`tenant_id`,`book_set_id`) REFERENCES `withholding_deposits`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`,`tenant_id`,`book_set_id`) REFERENCES `withholding_events`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_deposit_allocation_amount" CHECK(typeof("withholding_deposit_allocations"."amount_minor") = 'integer' AND "withholding_deposit_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_withholding_deposit_allocation_event` ON `withholding_deposit_allocations` (`deposit_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `idx_withholding_deposit_allocations_event` ON `withholding_deposit_allocations` (`tenant_id`,`book_set_id`,`event_id`);--> statement-breakpoint
CREATE TABLE `withholding_deposits` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`tax_kind` text NOT NULL,
	`liability_account_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`deposit_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`cin` text,
	`bsr_code` text,
	`challan_date` text,
	`serial_number` text,
	`evidence_reference` text,
	`journal_id` text NOT NULL,
	`reversal_of_deposit_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`liability_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_deposit_kind" CHECK("withholding_deposits"."tax_kind" IN ('TDS', 'TCS')),
	CONSTRAINT "chk_withholding_deposit_amount" CHECK(typeof("withholding_deposits"."amount_minor") = 'integer' AND "withholding_deposits"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_withholding_deposits_scope_key` ON `withholding_deposits` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_withholding_deposits_register` ON `withholding_deposits` (`tenant_id`,`book_set_id`,`tax_kind`,`deposit_date`,`id`);--> statement-breakpoint
CREATE TABLE `withholding_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`tax_kind` text NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text NOT NULL,
	`rule_snapshot_id` text NOT NULL,
	`event_date` text NOT NULL,
	`tax_base_minor` integer NOT NULL,
	`tax_amount_minor` integer NOT NULL,
	`rate_bps` integer NOT NULL,
	`rounding_mode` text NOT NULL,
	`liability_account_id` text NOT NULL,
	`threshold_evidence_json` text NOT NULL,
	`calculation_facts_json` text NOT NULL,
	`rule_canonical_hash` text NOT NULL,
	`journal_id` text NOT NULL,
	`status` text NOT NULL,
	`reversal_of_event_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_snapshot_id`,`tenant_id`) REFERENCES `tax_rule_snapshots`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`liability_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_withholding_event_kind" CHECK("withholding_events"."tax_kind" IN ('TDS', 'TCS')),
	CONSTRAINT "chk_withholding_event_document" CHECK("withholding_events"."document_type" IN ('PURCHASE', 'SALE')),
	CONSTRAINT "chk_withholding_event_amounts" CHECK(typeof("withholding_events"."tax_base_minor") = 'integer' AND "withholding_events"."tax_base_minor" > 0 AND typeof("withholding_events"."tax_amount_minor") = 'integer' AND "withholding_events"."tax_amount_minor" >= 0),
	CONSTRAINT "chk_withholding_event_status" CHECK("withholding_events"."status" IN ('POSTED', 'REVERSED', 'CORRECTED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_withholding_events_document_kind` ON `withholding_events` (`tenant_id`,`book_set_id`,`tax_kind`,`document_type`,`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_withholding_events_scope_key` ON `withholding_events` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_withholding_events_register` ON `withholding_events` (`tenant_id`,`book_set_id`,`tax_kind`,`event_date`,`id`);--> statement-breakpoint
CREATE TRIGGER `vendor_bills_withholding_valid_insert` BEFORE INSERT ON `vendor_bills`
WHEN NEW.withholding_minor < 0 OR NEW.withholding_minor > NEW.total_minor - NEW.paid_minor
BEGIN SELECT RAISE(ABORT, 'vendor bill withholding amount is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER `vendor_bills_withholding_valid_update` BEFORE UPDATE ON `vendor_bills`
WHEN NEW.withholding_minor < 0 OR NEW.withholding_minor > NEW.total_minor - NEW.paid_minor
BEGIN SELECT RAISE(ABORT, 'vendor bill withholding amount is invalid'); END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `vendor_bills_posted_fields_immutable`;
--> statement-breakpoint
CREATE TRIGGER `vendor_bills_posted_fields_immutable` BEFORE UPDATE ON `vendor_bills`
WHEN OLD.status <> 'DRAFT' AND NOT (
  NEW.id IS OLD.id AND NEW.tenant_id IS OLD.tenant_id AND NEW.book_set_id IS OLD.book_set_id
  AND NEW.bill_number IS OLD.bill_number AND NEW.vendor_id IS OLD.vendor_id AND NEW.bill_date IS OLD.bill_date
  AND NEW.due_date IS OLD.due_date AND NEW.narration IS OLD.narration AND NEW.total_minor IS OLD.total_minor
  AND NEW.gst_input_json IS OLD.gst_input_json AND NEW.withholding_minor IS OLD.withholding_minor
  AND NEW.payable_account_id IS OLD.payable_account_id AND NEW.posted_journal_id IS OLD.posted_journal_id
  AND NEW.created_at IS OLD.created_at AND NEW.posted_at IS OLD.posted_at AND NEW.updated_at IS NOT OLD.updated_at
  AND NEW.paid_minor >= OLD.paid_minor AND NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
  AND NEW.paid_minor IS (SELECT COALESCE(SUM(amount_minor), 0) FROM vendor_payment_allocations WHERE tenant_id = OLD.tenant_id AND book_set_id = OLD.book_set_id AND bill_id = OLD.id)
  AND NEW.status IS CASE WHEN NEW.paid_minor + NEW.withholding_minor = 0 THEN 'POSTED' WHEN NEW.paid_minor + NEW.withholding_minor >= NEW.total_minor THEN 'PAID' ELSE 'PARTIALLY_PAID' END
)
BEGIN SELECT RAISE(ABORT, 'posted vendor bill financial fields are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `tenant_deductor_profiles_no_overlap` BEFORE INSERT ON `tenant_deductor_profiles`
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM tenant_deductor_profiles p WHERE p.tenant_id = NEW.tenant_id AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31') AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from) THEN RAISE(ABORT, 'overlapping tenant deductor profile effective date ranges') END; END;
--> statement-breakpoint
CREATE TRIGGER `tenant_deductor_profiles_no_overlap_upd` BEFORE UPDATE ON `tenant_deductor_profiles`
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM tenant_deductor_profiles p WHERE p.tenant_id = NEW.tenant_id AND p.id <> NEW.id AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31') AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from) THEN RAISE(ABORT, 'overlapping tenant deductor profile effective date ranges') END; END;
--> statement-breakpoint
CREATE TRIGGER `party_tax_profiles_no_overlap` BEFORE INSERT ON `party_tax_profiles`
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM party_tax_profiles p WHERE p.tenant_id = NEW.tenant_id AND p.book_set_id = NEW.book_set_id AND p.party_id = NEW.party_id AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31') AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from) THEN RAISE(ABORT, 'overlapping party tax profile effective date ranges') END; END;
--> statement-breakpoint
CREATE TRIGGER `party_tax_profiles_no_overlap_upd` BEFORE UPDATE ON `party_tax_profiles`
BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM party_tax_profiles p WHERE p.tenant_id = NEW.tenant_id AND p.book_set_id = NEW.book_set_id AND p.party_id = NEW.party_id AND p.id <> NEW.id AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31') AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from) THEN RAISE(ABORT, 'overlapping party tax profile effective date ranges') END; END;
--> statement-breakpoint
CREATE TRIGGER `tax_rule_snapshots_no_update` BEFORE UPDATE ON `tax_rule_snapshots` BEGIN SELECT RAISE(ABORT, 'tax rule snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `tax_rule_snapshots_no_delete` BEFORE DELETE ON `tax_rule_snapshots` BEGIN SELECT RAISE(ABORT, 'tax rule snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `withholding_events_no_update` BEFORE UPDATE ON `withholding_events` BEGIN SELECT RAISE(ABORT, 'withholding events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `withholding_events_no_delete` BEFORE DELETE ON `withholding_events` BEGIN SELECT RAISE(ABORT, 'withholding events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `withholding_deposits_no_update` BEFORE UPDATE ON `withholding_deposits` BEGIN SELECT RAISE(ABORT, 'withholding deposits are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `withholding_deposits_no_delete` BEFORE DELETE ON `withholding_deposits` BEGIN SELECT RAISE(ABORT, 'withholding deposits are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `withholding_deposit_allocations_no_update` BEFORE UPDATE ON `withholding_deposit_allocations` BEGIN SELECT RAISE(ABORT, 'withholding deposit allocations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `withholding_deposit_allocations_no_delete` BEFORE DELETE ON `withholding_deposit_allocations` BEGIN SELECT RAISE(ABORT, 'withholding deposit allocations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `withholding_compliance_cases_no_update` BEFORE UPDATE ON `withholding_compliance_cases` BEGIN SELECT RAISE(ABORT, 'withholding compliance cases are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `withholding_compliance_cases_no_delete` BEFORE DELETE ON `withholding_compliance_cases` BEGIN SELECT RAISE(ABORT, 'withholding compliance cases are immutable'); END;
