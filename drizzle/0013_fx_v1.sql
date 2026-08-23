CREATE TABLE `bank_account_currencies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`account_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`exponent` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_bank_account_currency_code" CHECK(length("bank_account_currencies"."currency_code") = 3 AND "bank_account_currencies"."currency_code" NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "chk_bank_account_currency_exponent" CHECK("bank_account_currencies"."exponent" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_account_currencies_account` ON `bank_account_currencies` (`tenant_id`,`book_set_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `bank_statement_line_currencies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`statement_line_id` text NOT NULL,
	`account_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`exponent` integer NOT NULL,
	`statement_minor` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_bank_statement_line_currency_code" CHECK(length("bank_statement_line_currencies"."currency_code") = 3 AND "bank_statement_line_currencies"."currency_code" NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "chk_bank_statement_line_currency_exponent" CHECK("bank_statement_line_currencies"."exponent" BETWEEN 0 AND 6),
	CONSTRAINT "chk_bank_statement_line_currency_amount" CHECK(typeof("bank_statement_line_currencies"."statement_minor") = 'integer' AND "bank_statement_line_currencies"."statement_minor" <> 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bank_statement_line_currencies_line` ON `bank_statement_line_currencies` (`tenant_id`,`book_set_id`,`statement_line_id`);--> statement-breakpoint
CREATE INDEX `idx_bank_statement_line_currencies_currency` ON `bank_statement_line_currencies` (`tenant_id`,`book_set_id`,`currency_code`,`statement_line_id`);--> statement-breakpoint
CREATE TABLE `fx_allocation_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`allocation_type` text NOT NULL,
	`allocation_id` text NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text NOT NULL,
	`foreign_minor` integer NOT NULL,
	`carrying_base_minor` integer NOT NULL,
	`actual_bank_base_minor` integer NOT NULL,
	`rate_snapshot_id` text NOT NULL,
	`realized_gain_loss_minor` integer NOT NULL,
	`gain_loss_account_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rate_snapshot_id`,`tenant_id`,`book_set_id`) REFERENCES `fx_rate_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gain_loss_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fx_allocation_facts_type" CHECK("fx_allocation_facts"."allocation_type" IN ('RECEIPT', 'VENDOR_PAYMENT')),
	CONSTRAINT "chk_fx_allocation_facts_document" CHECK("fx_allocation_facts"."document_type" IN ('SALES_INVOICE', 'VENDOR_BILL')),
	CONSTRAINT "chk_fx_allocation_facts_amounts" CHECK("fx_allocation_facts"."foreign_minor" > 0 AND "fx_allocation_facts"."carrying_base_minor" > 0 AND "fx_allocation_facts"."actual_bank_base_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_allocation_facts_allocation` ON `fx_allocation_facts` (`tenant_id`,`book_set_id`,`allocation_type`,`allocation_id`);--> statement-breakpoint
CREATE INDEX `idx_fx_allocation_facts_document` ON `fx_allocation_facts` (`tenant_id`,`book_set_id`,`document_type`,`document_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `fx_document_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`exponent` integer NOT NULL,
	`rate_snapshot_id` text NOT NULL,
	`rounding_policy` text NOT NULL,
	`total_foreign_minor` integer NOT NULL,
	`total_base_minor` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rate_snapshot_id`,`tenant_id`,`book_set_id`) REFERENCES `fx_rate_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fx_document_facts_type" CHECK("fx_document_facts"."document_type" IN ('SALES_INVOICE', 'VENDOR_BILL')),
	CONSTRAINT "chk_fx_document_facts_exponent" CHECK("fx_document_facts"."exponent" BETWEEN 0 AND 6),
	CONSTRAINT "chk_fx_document_facts_rounding" CHECK("fx_document_facts"."rounding_policy" IN ('HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEILING')),
	CONSTRAINT "chk_fx_document_facts_amounts" CHECK("fx_document_facts"."total_foreign_minor" > 0 AND "fx_document_facts"."total_base_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_document_facts_document` ON `fx_document_facts` (`tenant_id`,`book_set_id`,`document_type`,`document_id`);--> statement-breakpoint
CREATE INDEX `idx_fx_document_facts_currency` ON `fx_document_facts` (`tenant_id`,`book_set_id`,`currency_code`,`document_type`,`document_id`);--> statement-breakpoint
CREATE TABLE `fx_document_line_amounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text NOT NULL,
	`line_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`foreign_minor` integer NOT NULL,
	`base_minor` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fx_document_line_amounts_type" CHECK("fx_document_line_amounts"."document_type" IN ('SALES_INVOICE', 'VENDOR_BILL')),
	CONSTRAINT "chk_fx_document_line_amounts_amounts" CHECK("fx_document_line_amounts"."foreign_minor" > 0 AND "fx_document_line_amounts"."base_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_document_line_amounts_line` ON `fx_document_line_amounts` (`tenant_id`,`book_set_id`,`document_type`,`document_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `idx_fx_document_line_amounts_document` ON `fx_document_line_amounts` (`tenant_id`,`book_set_id`,`document_id`,`line_number`);--> statement-breakpoint
CREATE TABLE `fx_rate_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`base_currency_code` text NOT NULL,
	`foreign_currency_code` text NOT NULL,
	`foreign_exponent` integer NOT NULL,
	`rate_decimal` text NOT NULL,
	`numerator` text NOT NULL,
	`scale` integer NOT NULL,
	`source` text NOT NULL,
	`purpose` text NOT NULL,
	`effective_date` text NOT NULL,
	`effective_at` text NOT NULL,
	`verified` integer NOT NULL,
	`evidence_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fx_rate_snapshot_codes" CHECK(length("fx_rate_snapshots"."base_currency_code") = 3 AND "fx_rate_snapshots"."base_currency_code" NOT GLOB '*[^A-Z]*' AND length("fx_rate_snapshots"."foreign_currency_code") = 3 AND "fx_rate_snapshots"."foreign_currency_code" NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "chk_fx_rate_snapshot_exponent" CHECK("fx_rate_snapshots"."foreign_exponent" BETWEEN 0 AND 6),
	CONSTRAINT "chk_fx_rate_snapshot_decimal" CHECK(length(trim("fx_rate_snapshots"."rate_decimal")) > 0 AND "fx_rate_snapshots"."rate_decimal" NOT GLOB '*[^0-9.]*'),
	CONSTRAINT "chk_fx_rate_snapshot_scale" CHECK("fx_rate_snapshots"."scale" BETWEEN 0 AND 18),
	CONSTRAINT "chk_fx_rate_snapshot_purpose" CHECK("fx_rate_snapshots"."purpose" IN ('BOOK_INITIAL', 'SETTLEMENT', 'PERIOD_END')),
	CONSTRAINT "chk_fx_rate_snapshot_verified" CHECK("fx_rate_snapshots"."verified" IN (0, 1)),
	CONSTRAINT "chk_fx_rate_snapshot_hash" CHECK(length("fx_rate_snapshots"."canonical_hash") = 64 AND "fx_rate_snapshots"."canonical_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_rate_snapshot_hash` ON `fx_rate_snapshots` (`tenant_id`,`book_set_id`,`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_rate_snapshots_scope` ON `fx_rate_snapshots` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_fx_rate_snapshots_purpose` ON `fx_rate_snapshots` (`tenant_id`,`book_set_id`,`foreign_currency_code`,`purpose`,`effective_date`);--> statement-breakpoint
CREATE TABLE `fx_revaluation_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`run_id` text NOT NULL,
	`document_type` text NOT NULL,
	`document_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`foreign_open_minor` integer NOT NULL,
	`carrying_base_minor` integer NOT NULL,
	`revalued_base_minor` integer NOT NULL,
	`adjustment_minor` integer NOT NULL,
	`rate_snapshot_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`,`tenant_id`,`book_set_id`) REFERENCES `fx_revaluation_runs`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rate_snapshot_id`,`tenant_id`,`book_set_id`) REFERENCES `fx_rate_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fx_revaluation_lines_document" CHECK("fx_revaluation_lines"."document_type" IN ('SALES_INVOICE', 'VENDOR_BILL')),
	CONSTRAINT "chk_fx_revaluation_lines_open" CHECK("fx_revaluation_lines"."foreign_open_minor" > 0 AND "fx_revaluation_lines"."carrying_base_minor" > 0 AND "fx_revaluation_lines"."revalued_base_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_revaluation_lines_run_document` ON `fx_revaluation_lines` (`run_id`,`document_type`,`document_id`);--> statement-breakpoint
CREATE TABLE `fx_revaluation_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`policy_code` text NOT NULL,
	`unrealized_gain_loss_account_id` text NOT NULL,
	`ar_adjustment_account_id` text NOT NULL,
	`ap_adjustment_account_id` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unrealized_gain_loss_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ar_adjustment_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ap_adjustment_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fx_revaluation_policy_code" CHECK("fx_revaluation_policies"."policy_code" IN ('AS_11', 'IND_AS_21', 'CUSTOM_SUPPORTED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_revaluation_policies_scope_hash` ON `fx_revaluation_policies` (`tenant_id`,`book_set_id`,`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_revaluation_policies_scope` ON `fx_revaluation_policies` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `fx_revaluation_reversals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`run_id` text NOT NULL,
	`journal_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`,`tenant_id`,`book_set_id`) REFERENCES `fx_revaluation_runs`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_revaluation_reversals_run` ON `fx_revaluation_reversals` (`run_id`);--> statement-breakpoint
CREATE TABLE `fx_revaluation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`as_of_date` text NOT NULL,
	`status` text NOT NULL,
	`journal_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_id`,`tenant_id`,`book_set_id`) REFERENCES `fx_revaluation_policies`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fx_revaluation_run_status" CHECK("fx_revaluation_runs"."status" IN ('PREVIEW', 'POSTED', 'REVERSED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_revaluation_runs_scope_date_policy` ON `fx_revaluation_runs` (`tenant_id`,`book_set_id`,`as_of_date`,`policy_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_revaluation_runs_scope` ON `fx_revaluation_runs` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `tenant_currencies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`currency_code` text NOT NULL,
	`exponent` integer NOT NULL,
	`is_base` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tenant_currency_code" CHECK(length("tenant_currencies"."currency_code") = 3 AND "tenant_currencies"."currency_code" NOT GLOB '*[^A-Z]*'),
	CONSTRAINT "chk_tenant_currency_exponent" CHECK("tenant_currencies"."exponent" BETWEEN 0 AND 6),
	CONSTRAINT "chk_tenant_currency_base" CHECK("tenant_currencies"."is_base" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_currencies_code` ON `tenant_currencies` (`tenant_id`,`currency_code`);--> statement-breakpoint
PRAGMA defer_foreign_keys = ON;--> statement-breakpoint
CREATE TRIGGER `trg_tenants_base_currency_immutable` BEFORE UPDATE OF `base_currency` ON `tenants` WHEN OLD.`base_currency` <> NEW.`base_currency` BEGIN SELECT RAISE(ABORT, 'BASE_CURRENCY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_rate_snapshots_immutable_update` BEFORE UPDATE ON `fx_rate_snapshots` BEGIN SELECT RAISE(ABORT, 'FX_RATE_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_rate_snapshots_immutable_delete` BEFORE DELETE ON `fx_rate_snapshots` BEGIN SELECT RAISE(ABORT, 'FX_RATE_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_document_facts_immutable_update` BEFORE UPDATE ON `fx_document_facts` BEGIN SELECT RAISE(ABORT, 'FX_DOCUMENT_FACT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_document_facts_immutable_delete` BEFORE DELETE ON `fx_document_facts` BEGIN SELECT RAISE(ABORT, 'FX_DOCUMENT_FACT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_document_line_amounts_immutable_update` BEFORE UPDATE ON `fx_document_line_amounts` BEGIN SELECT RAISE(ABORT, 'FX_DOCUMENT_LINE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_document_line_amounts_immutable_delete` BEFORE DELETE ON `fx_document_line_amounts` BEGIN SELECT RAISE(ABORT, 'FX_DOCUMENT_LINE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_allocation_facts_immutable_update` BEFORE UPDATE ON `fx_allocation_facts` BEGIN SELECT RAISE(ABORT, 'FX_ALLOCATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_allocation_facts_immutable_delete` BEFORE DELETE ON `fx_allocation_facts` BEGIN SELECT RAISE(ABORT, 'FX_ALLOCATION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_revaluation_policies_immutable_update` BEFORE UPDATE ON `fx_revaluation_policies` BEGIN SELECT RAISE(ABORT, 'FX_POLICY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_revaluation_policies_immutable_delete` BEFORE DELETE ON `fx_revaluation_policies` BEGIN SELECT RAISE(ABORT, 'FX_POLICY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_revaluation_lines_immutable_update` BEFORE UPDATE ON `fx_revaluation_lines` BEGIN SELECT RAISE(ABORT, 'FX_REVALUATION_LINE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_fx_revaluation_lines_immutable_delete` BEFORE DELETE ON `fx_revaluation_lines` BEGIN SELECT RAISE(ABORT, 'FX_REVALUATION_LINE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_bank_account_currencies_immutable_update` BEFORE UPDATE ON `bank_account_currencies` BEGIN SELECT RAISE(ABORT, 'BANK_ACCOUNT_CURRENCY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_bank_account_currencies_immutable_delete` BEFORE DELETE ON `bank_account_currencies` BEGIN SELECT RAISE(ABORT, 'BANK_ACCOUNT_CURRENCY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_bank_statement_line_currencies_immutable_update` BEFORE UPDATE ON `bank_statement_line_currencies` BEGIN SELECT RAISE(ABORT, 'BANK_STATEMENT_CURRENCY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_bank_statement_line_currencies_immutable_delete` BEFORE DELETE ON `bank_statement_line_currencies` BEGIN SELECT RAISE(ABORT, 'BANK_STATEMENT_CURRENCY_IMMUTABLE'); END;
