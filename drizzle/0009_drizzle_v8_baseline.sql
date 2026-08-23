CREATE TABLE `bank_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`statement_id` text NOT NULL,
	`statement_line_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`status` text NOT NULL,
	`confirmed_at` text NOT NULL,
	`undone_at` text,
	`undo_reason` text,
	FOREIGN KEY (`statement_id`,`tenant_id`,`book_set_id`,`bank_account_id`) REFERENCES `bank_statements`(`id`,`tenant_id`,`book_set_id`,`bank_account_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`statement_line_id`,`tenant_id`,`book_set_id`,`statement_id`) REFERENCES `bank_statement_lines`(`id`,`tenant_id`,`book_set_id`,`statement_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_match_scope_key` ON `bank_matches` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_match_active_line` ON `bank_matches` (`statement_line_id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_match_active_journal_account` ON `bank_matches` (`journal_entry_id`,`bank_account_id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_bank_matches_scope_status` ON `bank_matches` (`tenant_id`,`book_set_id`,`status`,`statement_id`,`statement_line_id`);--> statement-breakpoint
CREATE TABLE `bank_statement_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`statement_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`transaction_date` text NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`signed_amount_minor` integer NOT NULL,
	FOREIGN KEY (`statement_id`,`tenant_id`,`book_set_id`) REFERENCES `bank_statements`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_statement_line_number` ON `bank_statement_lines` (`statement_id`,`line_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_statement_line_scope_key` ON `bank_statement_lines` (`id`,`tenant_id`,`book_set_id`,`statement_id`);--> statement-breakpoint
CREATE INDEX `idx_bank_statement_lines_scope_date` ON `bank_statement_lines` (`tenant_id`,`book_set_id`,`statement_id`,`transaction_date`,`line_number`);--> statement-breakpoint
CREATE TABLE `bank_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`external_statement_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`opening_balance_minor` integer NOT NULL,
	`closing_balance_minor` integer NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_statement_external` ON `bank_statements` (`tenant_id`,`book_set_id`,`bank_account_id`,`external_statement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_statement_scope_key` ON `bank_statements` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_statement_account_key` ON `bank_statements` (`id`,`tenant_id`,`book_set_id`,`bank_account_id`);--> statement-breakpoint
CREATE INDEX `idx_bank_statements_scope_period` ON `bank_statements` (`tenant_id`,`book_set_id`,`period_start`,`period_end`,`id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`account_type` text NOT NULL,
	`parent_account_id` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`) REFERENCES `book_sets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_account_code_scope` ON `accounts` (`tenant_id`,`book_set_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_accounts_tenant_book_set` ON `accounts` (`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `audit_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`request_id` text,
	`entity_type` text,
	`entity_id` text,
	`change_summary` text,
	`evidence_ids` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_records_tenant` ON `audit_records` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_records_request_id` ON `audit_records` (`request_id`);--> statement-breakpoint
CREATE TABLE `book_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`lifecycle` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_book_set_tenant_kind` ON `book_sets` (`tenant_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_book_sets_tenant` ON `book_sets` (`tenant_id`);--> statement-breakpoint
CREATE TABLE database_control (
  id INTEGER PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  data_format_version INTEGER NOT NULL,
  reader_compatibility_min INTEGER NOT NULL,
  reader_compatibility_max INTEGER NOT NULL,
  required_writer_protocol INTEGER NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  last_migration_id TEXT NOT NULL,
  last_migration_checksum TEXT NOT NULL,
  last_writer_cli_version TEXT NOT NULL,
  last_writer_build_id TEXT NOT NULL,
  last_writer_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  recovery_reason TEXT,
  CONSTRAINT chk_id_singleton CHECK(id=1),
  CONSTRAINT chk_schema_version CHECK(schema_version>=1 AND typeof(schema_version)='integer'),
  CONSTRAINT chk_data_format_version CHECK(data_format_version>=1 AND typeof(data_format_version)='integer'),
  CONSTRAINT chk_reader_min CHECK(reader_compatibility_min>=1 AND typeof(reader_compatibility_min)='integer'),
  CONSTRAINT chk_reader_max CHECK(reader_compatibility_max>=reader_compatibility_min AND typeof(reader_compatibility_max)='integer'),
  CONSTRAINT chk_writer_protocol CHECK(required_writer_protocol>=1 AND typeof(required_writer_protocol)='integer'),
  CONSTRAINT chk_state CHECK(state IN ('READY','APPLYING','RECOVERY_REQUIRED')),
  CONSTRAINT chk_revision CHECK(revision>=1 AND typeof(revision)='integer'),
  CONSTRAINT chk_generation CHECK(generation>=1 AND typeof(generation)='integer'),
  CONSTRAINT chk_last_migration_id CHECK(trim(last_migration_id)<>''),
  CONSTRAINT chk_checksum_length CHECK(length(last_migration_checksum)=64),
  CONSTRAINT chk_checksum_hex CHECK(last_migration_checksum NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT chk_cli_version CHECK(trim(last_writer_cli_version)<>''),
  CONSTRAINT chk_build_id CHECK(trim(last_writer_build_id)<>''),
  CONSTRAINT chk_writer_at CHECK(trim(last_writer_at)<>''),
  CONSTRAINT chk_created_at CHECK(trim(created_at)<>''),
  CONSTRAINT chk_updated_at CHECK(trim(updated_at)<>''),
  CONSTRAINT chk_recovery_reason_state CHECK(
    CASE
      WHEN state='RECOVERY_REQUIRED' THEN recovery_reason IS NOT NULL AND trim(recovery_reason)<>''
      WHEN state IN ('READY','APPLYING') THEN recovery_reason IS NULL
      ELSE 0
    END
  )
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`storage_reference` text,
	`metadata_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_content_hash_unique` ON `evidence` (`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_evidence_tenant` ON `evidence` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `gst_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`gstin` text NOT NULL,
	`state` text,
	`scheme` text,
	`status` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`fingerprint` text,
	`fingerprint_key_id` text,
	`last_four` text,
	`redacted_display` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_gst_registrations_tenant` ON `gst_registrations` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`result_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_idempotency_key` ON `idempotency_records` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `legal_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_type` text NOT NULL,
	`fingerprint` text NOT NULL,
	`fingerprint_key_id` text,
	`last_four` text,
	`redacted_display` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_identities_fingerprint_unique` ON `legal_identities` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `tenant_creation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`tenant_id` text,
	`result_json` text,
	`result_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_creation_requests_request_id_unique` ON `tenant_creation_requests` (`request_id`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`lifecycle` text NOT NULL,
	`name` text NOT NULL,
	`base_currency` text DEFAULT 'INR' NOT NULL,
	`default_book_set_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`receipt_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`reference` text,
	`journal_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`,`tenant_id`,`book_set_id`) REFERENCES `parties`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_receipts_id_tenant_book_set_v6` ON `bank_receipts` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_bank_receipts_scope_date_v6` ON `bank_receipts` (`tenant_id`,`book_set_id`,`receipt_date`,`id`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`posting_date` text NOT NULL,
	`reference` text,
	`narration` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`posted_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_journal_entries_id_tenant_book_set_v5` ON `journal_entries` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_journal_entries_scope_date` ON `journal_entries` (`tenant_id`,`book_set_id`,`posting_date`,`id`);--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`journal_entry_id` text NOT NULL,
	`account_id` text NOT NULL,
	`description` text,
	`debit_minor` integer DEFAULT 0 NOT NULL,
	`credit_minor` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`journal_entry_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_journal_lines_entry` ON `journal_lines` (`tenant_id`,`book_set_id`,`journal_entry_id`);--> statement-breakpoint
CREATE INDEX `idx_journal_lines_account` ON `journal_lines` (`tenant_id`,`book_set_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `parties` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`phone` text,
	`party_role` text DEFAULT 'CUSTOMER' NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_parties_id_tenant_book_set_v6` ON `parties` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_parties_scope_name_v6` ON `parties` (`tenant_id`,`book_set_id`,`display_name`);--> statement-breakpoint
CREATE INDEX `idx_parties_scope_role_v7` ON `parties` (`tenant_id`,`book_set_id`,`party_role`,`display_name`);--> statement-breakpoint
CREATE TABLE `sales_invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`description` text NOT NULL,
	`revenue_account_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	FOREIGN KEY (`invoice_id`,`tenant_id`,`book_set_id`) REFERENCES `sales_invoices`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revenue_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sales_invoice_line_number` ON `sales_invoice_lines` (`invoice_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `idx_sales_invoice_lines_invoice_v6` ON `sales_invoice_lines` (`tenant_id`,`book_set_id`,`invoice_id`,`line_number`);--> statement-breakpoint
CREATE TABLE `sales_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`customer_id` text NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text,
	`narration` text,
	`status` text NOT NULL,
	`total_minor` integer NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`receivable_account_id` text,
	`posted_journal_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`posted_at` text,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`,`tenant_id`,`book_set_id`) REFERENCES `parties`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receivable_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sales_invoice_number_scope` ON `sales_invoices` (`tenant_id`,`book_set_id`,`invoice_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sales_invoices_id_tenant_book_set_v6` ON `sales_invoices` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_invoice_scope_status_v6` ON `sales_invoices` (`tenant_id`,`book_set_id`,`status`,`issue_date`,`id`);--> statement-breakpoint
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
	FOREIGN KEY (`expense_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vendor_bill_line_number` ON `vendor_bill_lines` (`bill_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `idx_vendor_bill_lines_bill_v7` ON `vendor_bill_lines` (`tenant_id`,`book_set_id`,`bill_id`,`line_number`);--> statement-breakpoint
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
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`,`tenant_id`,`book_set_id`) REFERENCES `parties`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payable_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vendor_bill_number_scope` ON `vendor_bills` (`tenant_id`,`book_set_id`,`bill_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vendor_bills_id_tenant_book_set_v7` ON `vendor_bills` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_vendor_bills_scope_status_v7` ON `vendor_bills` (`tenant_id`,`book_set_id`,`status`,`bill_date`,`id`);--> statement-breakpoint
CREATE TABLE `vendor_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`payment_date` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`reference` text,
	`amount_minor` integer NOT NULL,
	`journal_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`vendor_id`,`tenant_id`,`book_set_id`) REFERENCES `parties`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_vendor_payments_id_tenant_book_set_v7` ON `vendor_payments` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_vendor_payments_scope_date_v7` ON `vendor_payments` (`tenant_id`,`book_set_id`,`payment_date`,`id`);
-- ==============================================================================
-- DRIZZLE MIGRATIONS TABLE (canonical history for fresh Drizzle-managed DBs)
-- Legacy schema_migrations table is NOT created here; only on bridged databases.
-- ==============================================================================

CREATE TABLE drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL UNIQUE,
  created_at NUMERIC NOT NULL
);

-- Seed baseline migration as applied
INSERT INTO drizzle_migrations (hash, created_at) VALUES
  ('0009_drizzle_v8_baseline', strftime('%s', 'now'));

-- ==============================================================================
-- COMPOSITE FOREIGN KEY CONSTRAINTS (via BEFORE triggers)
-- ==============================================================================

-- tenants.default_book_set_id must belong to the same tenant
CREATE TRIGGER `tenants_default_book_set_tenant_match` BEFORE INSERT ON `tenants`
WHEN NEW.default_book_set_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.default_book_set_id AND tenant_id = NEW.id
    ) THEN RAISE(ABORT, 'default_book_set_id must belong to same tenant')
  END;
END;

CREATE TRIGGER `tenants_default_book_set_tenant_match_upd` BEFORE UPDATE ON `tenants`
WHEN NEW.default_book_set_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.default_book_set_id AND tenant_id = NEW.id
    ) THEN RAISE(ABORT, 'default_book_set_id must belong to same tenant')
  END;
END;

-- accounts.book_set_id must belong to accounts.tenant_id (critical tenant isolation)
CREATE TRIGGER `accounts_book_set_tenant_match` BEFORE INSERT ON `accounts`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.book_set_id AND tenant_id = NEW.tenant_id
    ) THEN RAISE(ABORT, 'account book_set_id must belong to account tenant_id')
  END;
END;

CREATE TRIGGER `accounts_book_set_tenant_match_upd` BEFORE UPDATE ON `accounts`
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.book_set_id AND tenant_id = NEW.tenant_id
    ) THEN RAISE(ABORT, 'account book_set_id must belong to account tenant_id')
  END;
END;

-- ==============================================================================
-- GST REGISTRATION EFFECTIVE DATE OVERLAP GUARD
-- ==============================================================================

CREATE TRIGGER `gst_registrations_no_overlap` BEFORE INSERT ON `gst_registrations`
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM gst_registrations gs
      WHERE gs.tenant_id = NEW.tenant_id
        AND gs.gstin = NEW.gstin
        AND gs.id != NEW.id
        AND gs.effective_from <= COALESCE(NEW.effective_to, '9999-12-31')
        AND COALESCE(gs.effective_to, '9999-12-31') >= NEW.effective_from
    ) THEN RAISE(ABORT, 'overlapping GST registration effective date ranges')
  END;
END;

CREATE TRIGGER `gst_registrations_no_overlap_upd` BEFORE UPDATE ON `gst_registrations`
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM gst_registrations gs
      WHERE gs.tenant_id = NEW.tenant_id
        AND gs.gstin = NEW.gstin
        AND gs.id != NEW.id
        AND gs.effective_from <= COALESCE(NEW.effective_to, '9999-12-31')
        AND COALESCE(gs.effective_to, '9999-12-31') >= NEW.effective_from
    ) THEN RAISE(ABORT, 'overlapping GST registration effective date ranges')
  END;
END;

-- ==============================================================================
-- AUDIT RECORDS: APPEND-ONLY GUARDS
-- ==============================================================================

CREATE TRIGGER `audit_records_no_update` BEFORE UPDATE ON `audit_records`
BEGIN
  SELECT RAISE(ABORT, 'audit_records are immutable');
END;

CREATE TRIGGER `audit_records_no_delete` BEFORE DELETE ON `audit_records`
BEGIN
  SELECT RAISE(ABORT, 'audit_records are immutable');
END;

-- ==============================================================================
-- JOURNAL ENTRIES: POSTED IMMUTABILITY GUARDS
-- ==============================================================================

CREATE TRIGGER `journal_entries_no_update` BEFORE UPDATE ON `journal_entries`
BEGIN
  SELECT RAISE(ABORT, 'posted journal entries are immutable');
END;

CREATE TRIGGER `journal_entries_no_delete` BEFORE DELETE ON `journal_entries`
BEGIN
  SELECT RAISE(ABORT, 'posted journal entries are immutable');
END;

CREATE TRIGGER `journal_lines_no_update` BEFORE UPDATE ON `journal_lines`
BEGIN
  SELECT RAISE(ABORT, 'posted journal lines are immutable');
END;

CREATE TRIGGER `journal_lines_no_delete` BEFORE DELETE ON `journal_lines`
BEGIN
  SELECT RAISE(ABORT, 'posted journal lines are immutable');
END;

-- ==============================================================================
-- SALES INVOICES: POSTED IMMUTABILITY AND STATUS LIFECYCLE GUARDS
-- ==============================================================================

CREATE TRIGGER `sales_invoices_no_delete_posted` BEFORE DELETE ON `sales_invoices`
WHEN OLD.status <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'posted sales invoices are immutable');
END;

CREATE TRIGGER `sales_invoices_posted_fields_immutable` BEFORE UPDATE ON `sales_invoices`
WHEN OLD.status <> 'DRAFT' AND NOT (
  NEW.id IS OLD.id AND NEW.tenant_id IS OLD.tenant_id AND NEW.book_set_id IS OLD.book_set_id
  AND NEW.invoice_number IS OLD.invoice_number AND NEW.customer_id IS OLD.customer_id
  AND NEW.issue_date IS OLD.issue_date AND NEW.due_date IS OLD.due_date
  AND NEW.narration IS OLD.narration AND NEW.total_minor IS OLD.total_minor
  AND NEW.receivable_account_id IS OLD.receivable_account_id AND NEW.posted_journal_id IS OLD.posted_journal_id
  AND NEW.created_at IS OLD.created_at AND NEW.posted_at IS OLD.posted_at
  AND NEW.updated_at IS NOT OLD.updated_at AND NEW.paid_minor >= OLD.paid_minor
  AND NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
)
BEGIN
  SELECT RAISE(ABORT, 'posted sales invoice financial fields are immutable');
END;

CREATE TRIGGER `sales_invoice_lines_no_update` BEFORE UPDATE ON `sales_invoice_lines`
BEGIN
  SELECT RAISE(ABORT, 'sales invoice lines are immutable');
END;

CREATE TRIGGER `sales_invoice_lines_no_delete` BEFORE DELETE ON `sales_invoice_lines`
BEGIN
  SELECT RAISE(ABORT, 'sales invoice lines are immutable');
END;

-- ==============================================================================
-- VENDOR BILLS: POSTED IMMUTABILITY AND STATUS LIFECYCLE GUARDS
-- ==============================================================================

CREATE TRIGGER `vendor_bills_no_delete_posted` BEFORE DELETE ON `vendor_bills`
WHEN OLD.status <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'posted vendor bills are immutable');
END;

CREATE TRIGGER `vendor_bills_posted_fields_immutable` BEFORE UPDATE ON `vendor_bills`
WHEN OLD.status <> 'DRAFT' AND NOT (
  NEW.id IS OLD.id AND NEW.tenant_id IS OLD.tenant_id AND NEW.book_set_id IS OLD.book_set_id
  AND NEW.bill_number IS OLD.bill_number AND NEW.vendor_id IS OLD.vendor_id
  AND NEW.bill_date IS OLD.bill_date AND NEW.due_date IS OLD.due_date
  AND NEW.narration IS OLD.narration AND NEW.total_minor IS OLD.total_minor
  AND NEW.payable_account_id IS OLD.payable_account_id AND NEW.posted_journal_id IS OLD.posted_journal_id
  AND NEW.created_at IS OLD.created_at AND NEW.posted_at IS OLD.posted_at
  AND NEW.updated_at IS NOT OLD.updated_at AND NEW.paid_minor >= OLD.paid_minor
  AND NEW.status IN ('POSTED', 'PARTIALLY_PAID', 'PAID')
)
BEGIN
  SELECT RAISE(ABORT, 'posted vendor bill financial fields are immutable');
END;

CREATE TRIGGER `vendor_bill_lines_no_update` BEFORE UPDATE ON `vendor_bill_lines`
BEGIN
  SELECT RAISE(ABORT, 'vendor bill lines are immutable');
END;

CREATE TRIGGER `vendor_bill_lines_no_delete` BEFORE DELETE ON `vendor_bill_lines`
BEGIN
  SELECT RAISE(ABORT, 'vendor bill lines are immutable');
END;

-- ==============================================================================
-- BANK STATEMENTS: IMMUTABLE AUDIT TRAIL
-- ==============================================================================

CREATE TRIGGER `bank_statements_no_update` BEFORE UPDATE ON `bank_statements`
BEGIN
  SELECT RAISE(ABORT, 'bank statements are immutable');
END;

CREATE TRIGGER `bank_statements_no_delete` BEFORE DELETE ON `bank_statements`
BEGIN
  SELECT RAISE(ABORT, 'bank statements are immutable');
END;

CREATE TRIGGER `bank_statement_lines_no_update` BEFORE UPDATE ON `bank_statement_lines`
BEGIN
  SELECT RAISE(ABORT, 'bank statement lines are immutable');
END;

CREATE TRIGGER `bank_statement_lines_no_delete` BEFORE DELETE ON `bank_statement_lines`
BEGIN
  SELECT RAISE(ABORT, 'bank statement lines are immutable');
END;

-- ==============================================================================
-- BANK MATCHES: APPEND-ONLY WITH STRICT LIFECYCLE GUARDS
-- ==============================================================================

CREATE TRIGGER `bank_matches_no_delete` BEFORE DELETE ON `bank_matches`
BEGIN
  SELECT RAISE(ABORT, 'bank matches are historical and cannot be deleted');
END;

CREATE TRIGGER `bank_matches_lifecycle_guard` BEFORE UPDATE ON `bank_matches`
WHEN NOT (
  OLD.status = 'ACTIVE' AND NEW.status = 'UNDONE'
  AND NEW.id IS OLD.id
  AND NEW.tenant_id IS OLD.tenant_id
  AND NEW.book_set_id IS OLD.book_set_id
  AND NEW.statement_id IS OLD.statement_id
  AND NEW.statement_line_id IS OLD.statement_line_id
  AND NEW.bank_account_id IS OLD.bank_account_id
  AND NEW.journal_entry_id IS OLD.journal_entry_id
  AND NEW.confirmed_at IS OLD.confirmed_at
  AND NEW.undone_at IS NOT NULL
  AND NEW.undo_reason IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'bank match lifecycle is append-only');
END;

