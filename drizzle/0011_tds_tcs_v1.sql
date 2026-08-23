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
ALTER TABLE `vendor_bills` ADD `withholding_minor` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
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
  AND NEW.status IS CASE WHEN NEW.paid_minor = 0 THEN 'POSTED' WHEN NEW.paid_minor >= NEW.total_minor THEN 'PAID' ELSE 'PARTIALLY_PAID' END
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
