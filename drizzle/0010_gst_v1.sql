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
CREATE INDEX `idx_gst_tax_components_snapshot` ON `gst_tax_components` (`tenant_id`,`book_set_id`,`snapshot_id`,`line_number`,`component`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `uq_gst_snapshot_sales_invoice` ON `gst_tax_snapshots` (`sales_invoice_id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_snapshot_vendor_bill` ON `gst_tax_snapshots` (`vendor_bill_id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gst_snapshot_scope_key` ON `gst_tax_snapshots` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_gst_snapshots_register` ON `gst_tax_snapshots` (`tenant_id`,`book_set_id`,`document_type`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `party_gst_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`party_id` text NOT NULL,
	`gstin` text,
	`treatment` text NOT NULL,
	`state_code` text NOT NULL,
	`local_component` text,
	`status` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`,`tenant_id`,`book_set_id`) REFERENCES `parties`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_party_gst_profile_treatment" CHECK("party_gst_profiles"."treatment" IN ('REGISTERED', 'UNREGISTERED', 'CONSUMER')),
	CONSTRAINT "chk_party_gst_profile_status" CHECK("party_gst_profiles"."status" IN ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "chk_party_gst_profile_state" CHECK(length("party_gst_profiles"."state_code") = 2 AND "party_gst_profiles"."state_code" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "chk_party_gst_profile_local_component" CHECK("party_gst_profiles"."local_component" IS NULL OR "party_gst_profiles"."local_component" IN ('SGST', 'UTGST')),
	CONSTRAINT "chk_party_gst_profile_gstin" CHECK(("party_gst_profiles"."treatment" = 'REGISTERED' AND "party_gst_profiles"."gstin" IS NOT NULL) OR ("party_gst_profiles"."treatment" IN ('UNREGISTERED', 'CONSUMER') AND "party_gst_profiles"."gstin" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_party_gst_profiles_scope_key` ON `party_gst_profiles` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_party_gst_profiles_scope_date` ON `party_gst_profiles` (`tenant_id`,`book_set_id`,`party_id`,`effective_from`,`id`);--> statement-breakpoint
ALTER TABLE `sales_invoices` ADD `gst_input_json` text;--> statement-breakpoint
ALTER TABLE `vendor_bills` ADD `gst_input_json` text;
--> statement-breakpoint
CREATE TRIGGER `party_gst_profiles_no_overlap` BEFORE INSERT ON `party_gst_profiles`
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM party_gst_profiles p
    WHERE p.tenant_id = NEW.tenant_id AND p.book_set_id = NEW.book_set_id AND p.party_id = NEW.party_id
      AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31')
      AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from
  ) THEN RAISE(ABORT, 'overlapping party GST profile effective date ranges') END;
END;
--> statement-breakpoint
CREATE TRIGGER `party_gst_profiles_no_overlap_upd` BEFORE UPDATE ON `party_gst_profiles`
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM party_gst_profiles p
    WHERE p.tenant_id = NEW.tenant_id AND p.book_set_id = NEW.book_set_id AND p.party_id = NEW.party_id AND p.id <> NEW.id
      AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31')
      AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from
  ) THEN RAISE(ABORT, 'overlapping party GST profile effective date ranges') END;
END;
--> statement-breakpoint
CREATE TRIGGER `gst_registrations_posted_snapshot_no_update` BEFORE UPDATE ON `gst_registrations`
WHEN EXISTS (SELECT 1 FROM gst_tax_snapshots s WHERE s.tenant_id = OLD.tenant_id AND s.seller_registration_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'GST registration facts are immutable after posting'); END;
--> statement-breakpoint
CREATE TRIGGER `gst_registrations_posted_snapshot_no_delete` BEFORE DELETE ON `gst_registrations`
WHEN EXISTS (SELECT 1 FROM gst_tax_snapshots s WHERE s.tenant_id = OLD.tenant_id AND s.seller_registration_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'GST registration facts are immutable after posting'); END;
--> statement-breakpoint
CREATE TRIGGER `party_gst_profiles_posted_snapshot_no_update` BEFORE UPDATE ON `party_gst_profiles`
WHEN EXISTS (SELECT 1 FROM gst_tax_snapshots s WHERE s.tenant_id = OLD.tenant_id AND s.book_set_id = OLD.book_set_id AND s.buyer_profile_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'party GST facts are immutable after posting'); END;
--> statement-breakpoint
CREATE TRIGGER `party_gst_profiles_posted_snapshot_no_delete` BEFORE DELETE ON `party_gst_profiles`
WHEN EXISTS (SELECT 1 FROM gst_tax_snapshots s WHERE s.tenant_id = OLD.tenant_id AND s.book_set_id = OLD.book_set_id AND s.buyer_profile_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'party GST facts are immutable after posting'); END;
--> statement-breakpoint
DROP TRIGGER `sales_invoices_posted_fields_immutable`;
--> statement-breakpoint
CREATE TRIGGER `sales_invoices_posted_fields_immutable` BEFORE UPDATE ON `sales_invoices`
WHEN OLD.status <> 'DRAFT' AND NOT (
  NEW.id IS OLD.id AND NEW.tenant_id IS OLD.tenant_id AND NEW.book_set_id IS OLD.book_set_id
  AND NEW.invoice_number IS OLD.invoice_number AND NEW.customer_id IS OLD.customer_id
  AND NEW.issue_date IS OLD.issue_date AND NEW.due_date IS OLD.due_date
  AND NEW.narration IS OLD.narration AND NEW.total_minor IS OLD.total_minor
  AND NEW.gst_input_json IS OLD.gst_input_json
  AND NEW.receivable_account_id IS OLD.receivable_account_id AND NEW.posted_journal_id IS OLD.posted_journal_id
  AND NEW.created_at IS OLD.created_at AND NEW.posted_at IS OLD.posted_at
  AND NEW.updated_at IS NOT OLD.updated_at AND NEW.paid_minor >= OLD.paid_minor
  AND NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
  AND NEW.paid_minor IS (SELECT COALESCE(SUM(amount_minor), 0) FROM bank_receipt_allocations WHERE tenant_id = OLD.tenant_id AND book_set_id = OLD.book_set_id AND invoice_id = OLD.id)
  AND NEW.status IS CASE WHEN NEW.paid_minor = 0 THEN 'POSTED' WHEN NEW.paid_minor = NEW.total_minor THEN 'PAID' ELSE 'PARTIALLY_PAID' END
)
BEGIN SELECT RAISE(ABORT, 'posted sales invoice financial fields are immutable'); END;
--> statement-breakpoint
DROP TRIGGER `vendor_bills_posted_fields_immutable`;
--> statement-breakpoint
CREATE TRIGGER `vendor_bills_posted_fields_immutable` BEFORE UPDATE ON `vendor_bills`
WHEN OLD.status <> 'DRAFT' AND NOT (
  NEW.id IS OLD.id AND NEW.tenant_id IS OLD.tenant_id AND NEW.book_set_id IS OLD.book_set_id
  AND NEW.bill_number IS OLD.bill_number AND NEW.vendor_id IS OLD.vendor_id
  AND NEW.bill_date IS OLD.bill_date AND NEW.due_date IS OLD.due_date
  AND NEW.narration IS OLD.narration AND NEW.total_minor IS OLD.total_minor
  AND NEW.gst_input_json IS OLD.gst_input_json
  AND NEW.payable_account_id IS OLD.payable_account_id AND NEW.posted_journal_id IS OLD.posted_journal_id
  AND NEW.created_at IS OLD.created_at AND NEW.posted_at IS OLD.posted_at
  AND NEW.updated_at IS NOT OLD.updated_at AND NEW.paid_minor >= OLD.paid_minor
  AND NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
  AND NEW.paid_minor IS (SELECT COALESCE(SUM(amount_minor), 0) FROM vendor_payment_allocations WHERE tenant_id = OLD.tenant_id AND book_set_id = OLD.book_set_id AND bill_id = OLD.id)
  AND NEW.status IS CASE WHEN NEW.paid_minor = 0 THEN 'POSTED' WHEN NEW.paid_minor = NEW.total_minor THEN 'PAID' ELSE 'PARTIALLY_PAID' END
)
BEGIN SELECT RAISE(ABORT, 'posted vendor bill financial fields are immutable'); END;
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
