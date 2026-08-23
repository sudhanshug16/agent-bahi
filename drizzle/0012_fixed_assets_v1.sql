CREATE UNIQUE INDEX `uq_vendor_bill_lines_id_tenant_book_set` ON `vendor_bill_lines` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `asset_book_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`framework` text NOT NULL,
	`source_reference` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`method` text NOT NULL,
	`useful_life_months` integer NOT NULL,
	`residual_minor` integer NOT NULL,
	`prorata_convention` text NOT NULL,
	`rounding_policy` text NOT NULL,
	`remainder_policy` text NOT NULL,
	`reducing_rate_bps` integer,
	`justification` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_asset_book_policy_framework" CHECK("asset_book_policies"."framework" IN ('AS_10', 'IND_AS_16', 'COMPANIES_ACT_SCHEDULE_II', 'CUSTOM_SUPPORTED')),
	CONSTRAINT "chk_asset_book_policy_method" CHECK("asset_book_policies"."method" IN ('STRAIGHT_LINE', 'REDUCING_BALANCE')),
	CONSTRAINT "chk_asset_book_policy_life" CHECK(typeof("asset_book_policies"."useful_life_months") = 'integer' AND "asset_book_policies"."useful_life_months" > 0),
	CONSTRAINT "chk_asset_book_policy_residual" CHECK(typeof("asset_book_policies"."residual_minor") = 'integer' AND "asset_book_policies"."residual_minor" >= 0),
	CONSTRAINT "chk_asset_book_policy_dates" CHECK("asset_book_policies"."effective_to" IS NULL OR "asset_book_policies"."effective_to" > "asset_book_policies"."effective_from"),
	CONSTRAINT "chk_asset_book_policy_prorata" CHECK("asset_book_policies"."prorata_convention" IN ('DAILY_ACTUAL_365', 'DAILY_ACTUAL_366', 'MONTHLY', 'FULL_MONTH')),
	CONSTRAINT "chk_asset_book_policy_rounding" CHECK("asset_book_policies"."rounding_policy" IN ('PAISE_HALF_UP', 'PAISE_DOWN', 'PAISE_UP')),
	CONSTRAINT "chk_asset_book_policy_remainder" CHECK("asset_book_policies"."remainder_policy" IN ('FINAL_PERIOD', 'PRO_RATA_FINAL_DAY'))
	,CONSTRAINT "chk_asset_book_policy_reducing_rate" CHECK("asset_book_policies"."reducing_rate_bps" IS NULL OR ("asset_book_policies"."reducing_rate_bps" > 0 AND "asset_book_policies"."reducing_rate_bps" <= 10000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_book_policies_scope_key` ON `asset_book_policies` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_book_policies_effective` ON `asset_book_policies` (`tenant_id`,`book_set_id`,`effective_from`,`id`);--> statement-breakpoint
CREATE TABLE `asset_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`component_number` integer NOT NULL,
	`description` text NOT NULL,
	`cost_minor` integer NOT NULL,
	`residual_minor` integer NOT NULL,
	`useful_life_months` integer NOT NULL,
	`method` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`,`tenant_id`,`book_set_id`) REFERENCES `fixed_assets`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_asset_component_number" CHECK("asset_components"."component_number" > 0),
	CONSTRAINT "chk_asset_component_cost" CHECK("asset_components"."cost_minor" > 0),
	CONSTRAINT "chk_asset_component_residual" CHECK("asset_components"."residual_minor" >= 0 AND "asset_components"."residual_minor" <= "asset_components"."cost_minor"),
	CONSTRAINT "chk_asset_component_life" CHECK("asset_components"."useful_life_months" > 0),
	CONSTRAINT "chk_asset_component_method" CHECK("asset_components"."method" IN ('STRAIGHT_LINE', 'REDUCING_BALANCE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_components_number` ON `asset_components` (`asset_id`,`component_number`);--> statement-breakpoint
CREATE INDEX `idx_asset_components_asset` ON `asset_components` (`tenant_id`,`book_set_id`,`asset_id`,`component_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_components_scope_key` ON `asset_components` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `asset_depreciation_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`run_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`component_id` text,
	`amount_minor` integer NOT NULL,
	`opening_accumulated_minor` integer NOT NULL,
	`closing_accumulated_minor` integer NOT NULL,
	`calculation_facts_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`,`tenant_id`,`book_set_id`) REFERENCES `asset_depreciation_runs`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`,`tenant_id`,`book_set_id`) REFERENCES `fixed_assets`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`component_id`,`tenant_id`,`book_set_id`) REFERENCES `asset_components`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_asset_depreciation_line_amount" CHECK("asset_depreciation_lines"."amount_minor" >= 0),
	CONSTRAINT "chk_asset_depreciation_line_accum" CHECK("asset_depreciation_lines"."opening_accumulated_minor" >= 0 AND "asset_depreciation_lines"."closing_accumulated_minor" >= "asset_depreciation_lines"."opening_accumulated_minor")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_depreciation_line_run_asset_component` ON `asset_depreciation_lines` (`run_id`,`asset_id`,`component_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_depreciation_lines_asset` ON `asset_depreciation_lines` (`tenant_id`,`book_set_id`,`asset_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `asset_depreciation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`status` text NOT NULL,
	`calculation_hash` text NOT NULL,
	`journal_id` text,
	`created_at` text NOT NULL,
	`posted_at` text,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_asset_depreciation_run_status" CHECK("asset_depreciation_runs"."status" IN ('PREVIEW', 'POSTED')),
	CONSTRAINT "chk_asset_depreciation_run_dates" CHECK("asset_depreciation_runs"."period_end" >= "asset_depreciation_runs"."period_start"),
	CONSTRAINT "chk_asset_depreciation_run_posted" CHECK(("asset_depreciation_runs"."status" = 'PREVIEW' AND "asset_depreciation_runs"."journal_id" IS NULL AND "asset_depreciation_runs"."posted_at" IS NULL) OR ("asset_depreciation_runs"."status" = 'POSTED' AND "asset_depreciation_runs"."journal_id" IS NOT NULL AND "asset_depreciation_runs"."posted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_depreciation_posted_period` ON `asset_depreciation_runs` (`tenant_id`,`book_set_id`,`period_start`,`period_end`) WHERE "asset_depreciation_runs"."status" = 'POSTED';--> statement-breakpoint
CREATE INDEX `idx_asset_depreciation_runs_period` ON `asset_depreciation_runs` (`tenant_id`,`book_set_id`,`period_start`,`period_end`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_depreciation_runs_scope_key` ON `asset_depreciation_runs` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `asset_disposals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`disposal_date` text NOT NULL,
	`proceeds_minor` integer NOT NULL,
	`proceeds_account_id` text NOT NULL,
	`carrying_amount_minor` integer NOT NULL,
	`gain_loss_minor` integer NOT NULL,
	`journal_id` text NOT NULL,
	`evidence_reference` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`asset_id`,`tenant_id`,`book_set_id`) REFERENCES `fixed_assets`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proceeds_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_asset_disposal_amounts" CHECK("asset_disposals"."proceeds_minor" >= 0 AND "asset_disposals"."carrying_amount_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_disposals_asset` ON `asset_disposals` (`asset_id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_disposals_date` ON `asset_disposals` (`tenant_id`,`book_set_id`,`disposal_date`,`asset_id`);--> statement-breakpoint
CREATE TABLE `asset_tax_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`block_code` text NOT NULL,
	`rule_snapshot_id` text NOT NULL,
	`opening_wdv_minor` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_snapshot_id`,`tenant_id`) REFERENCES `asset_tax_rule_snapshots`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_asset_tax_block_opening_wdv" CHECK("asset_tax_blocks"."opening_wdv_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_tax_block_scope_key` ON `asset_tax_blocks` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_tax_block_scope_code` ON `asset_tax_blocks` (`tenant_id`,`book_set_id`,`block_code`);--> statement-breakpoint
CREATE TABLE `asset_tax_rule_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`law_name` text NOT NULL,
	`rule_reference` text NOT NULL,
	`version` text NOT NULL,
	`source_url` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`block_code` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`half_rate_condition` text NOT NULL,
	`calculation_facts_json` text NOT NULL,
	`source_verified` integer NOT NULL,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_asset_tax_rule_rate" CHECK("asset_tax_rule_snapshots"."rate_bps" >= 0 AND "asset_tax_rule_snapshots"."rate_bps" <= 10000),
	CONSTRAINT "chk_asset_tax_rule_dates" CHECK("asset_tax_rule_snapshots"."effective_to" IS NULL OR "asset_tax_rule_snapshots"."effective_to" > "asset_tax_rule_snapshots"."effective_from"),
	CONSTRAINT "chk_asset_tax_rule_source" CHECK("asset_tax_rule_snapshots"."source_url" GLOB 'https://*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_tax_rule_snapshot_identity` ON `asset_tax_rule_snapshots` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_tax_rule_snapshot_effective` ON `asset_tax_rule_snapshots` (`tenant_id`,`block_code`,`effective_from`,`id`);--> statement-breakpoint
CREATE TABLE `asset_tax_run_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`run_id` text NOT NULL,
	`block_id` text NOT NULL,
	`opening_wdv_minor` integer NOT NULL,
	`additions_full_minor` integer NOT NULL,
	`additions_half_minor` integer NOT NULL,
	`business_use_bps` integer NOT NULL,
	`disposal_consideration_minor` integer NOT NULL,
	`depreciation_minor` integer NOT NULL,
	`closing_wdv_minor` integer NOT NULL,
	`cessation` integer NOT NULL,
	`negative_proceeds` integer NOT NULL,
	`calculation_facts_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`,`tenant_id`,`book_set_id`) REFERENCES `asset_tax_runs`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`block_id`,`tenant_id`,`book_set_id`) REFERENCES `asset_tax_blocks`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_asset_tax_run_line_amounts" CHECK("asset_tax_run_lines"."opening_wdv_minor" >= 0 AND "asset_tax_run_lines"."additions_full_minor" >= 0 AND "asset_tax_run_lines"."additions_half_minor" >= 0 AND "asset_tax_run_lines"."disposal_consideration_minor" >= 0 AND "asset_tax_run_lines"."depreciation_minor" >= 0 AND "asset_tax_run_lines"."closing_wdv_minor" >= 0),
	CONSTRAINT "chk_asset_tax_run_line_business_use" CHECK("asset_tax_run_lines"."business_use_bps" >= 1 AND "asset_tax_run_lines"."business_use_bps" <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_tax_run_line_block` ON `asset_tax_run_lines` (`run_id`,`block_id`);--> statement-breakpoint
CREATE TABLE `asset_tax_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`status` text NOT NULL,
	`calculation_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_asset_tax_run_status" CHECK("asset_tax_runs"."status" = 'COMPUTED'),
	CONSTRAINT "chk_asset_tax_run_dates" CHECK("asset_tax_runs"."period_end" >= "asset_tax_runs"."period_start")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_tax_run_period` ON `asset_tax_runs` (`tenant_id`,`book_set_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_tax_runs_scope_key` ON `asset_tax_runs` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `fixed_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`asset_number` text NOT NULL,
	`acquisition_date` text NOT NULL,
	`put_to_use_date` text NOT NULL,
	`description` text NOT NULL,
	`category` text,
	`location` text,
	`custodian` text,
	`cost_minor` integer NOT NULL,
	`business_use_bps` integer NOT NULL,
	`asset_account_id` text NOT NULL,
	`accumulated_depreciation_account_id` text NOT NULL,
	`depreciation_expense_account_id` text NOT NULL,
	`gain_loss_account_id` text NOT NULL,
	`book_policy_id` text NOT NULL,
	`tax_block_id` text,
	`source_vendor_bill_line_id` text,
	`acquisition_journal_id` text,
	`evidence_reference` text,
	`status` text NOT NULL,
	`disposed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accumulated_depreciation_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depreciation_expense_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gain_loss_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_policy_id`,`tenant_id`,`book_set_id`) REFERENCES `asset_book_policies`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_block_id`,`tenant_id`,`book_set_id`) REFERENCES `asset_tax_blocks`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_vendor_bill_line_id`,`tenant_id`,`book_set_id`) REFERENCES `vendor_bill_lines`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acquisition_journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_fixed_asset_status" CHECK("fixed_assets"."status" IN ('ACTIVE', 'DISPOSED')),
	CONSTRAINT "chk_fixed_asset_cost" CHECK(typeof("fixed_assets"."cost_minor") = 'integer' AND "fixed_assets"."cost_minor" > 0),
	CONSTRAINT "chk_fixed_asset_business_use" CHECK(typeof("fixed_assets"."business_use_bps") = 'integer' AND "fixed_assets"."business_use_bps" >= 1 AND "fixed_assets"."business_use_bps" <= 10000),
	CONSTRAINT "chk_fixed_asset_dates" CHECK("fixed_assets"."put_to_use_date" >= "fixed_assets"."acquisition_date"),
	CONSTRAINT "chk_fixed_asset_disposed" CHECK(("fixed_assets"."status" = 'ACTIVE' AND "fixed_assets"."disposed_at" IS NULL) OR ("fixed_assets"."status" = 'DISPOSED' AND "fixed_assets"."disposed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fixed_assets_asset_number_scope` ON `fixed_assets` (`tenant_id`,`book_set_id`,`asset_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fixed_assets_scope_key` ON `fixed_assets` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fixed_assets_source_bill_line` ON `fixed_assets` (`tenant_id`,`book_set_id`,`source_vendor_bill_line_id`) WHERE "fixed_assets"."source_vendor_bill_line_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_fixed_assets_register` ON `fixed_assets` (`tenant_id`,`book_set_id`,`acquisition_date`,`asset_number`,`id`);--> statement-breakpoint
CREATE TRIGGER `asset_book_policies_no_update` BEFORE UPDATE ON `asset_book_policies` BEGIN SELECT RAISE(ABORT, 'asset book policies are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_book_policies_no_delete` BEFORE DELETE ON `asset_book_policies` BEGIN SELECT RAISE(ABORT, 'asset book policies are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `fixed_assets_no_update` BEFORE UPDATE ON `fixed_assets` WHEN NOT (OLD.status = 'ACTIVE' AND NEW.status = 'DISPOSED' AND OLD.disposed_at IS NULL AND NEW.disposed_at IS NOT NULL AND OLD.id = NEW.id AND OLD.tenant_id = NEW.tenant_id AND OLD.book_set_id = NEW.book_set_id AND OLD.asset_number = NEW.asset_number AND OLD.acquisition_date = NEW.acquisition_date AND OLD.put_to_use_date = NEW.put_to_use_date AND OLD.description = NEW.description AND COALESCE(OLD.category, '') = COALESCE(NEW.category, '') AND COALESCE(OLD.location, '') = COALESCE(NEW.location, '') AND COALESCE(OLD.custodian, '') = COALESCE(NEW.custodian, '') AND OLD.cost_minor = NEW.cost_minor AND OLD.business_use_bps = NEW.business_use_bps AND OLD.asset_account_id = NEW.asset_account_id AND OLD.accumulated_depreciation_account_id = NEW.accumulated_depreciation_account_id AND OLD.depreciation_expense_account_id = NEW.depreciation_expense_account_id AND OLD.gain_loss_account_id = NEW.gain_loss_account_id AND OLD.book_policy_id = NEW.book_policy_id AND COALESCE(OLD.tax_block_id, '') = COALESCE(NEW.tax_block_id, '') AND COALESCE(OLD.source_vendor_bill_line_id, '') = COALESCE(NEW.source_vendor_bill_line_id, '') AND COALESCE(OLD.acquisition_journal_id, '') = COALESCE(NEW.acquisition_journal_id, '') AND COALESCE(OLD.evidence_reference, '') = COALESCE(NEW.evidence_reference, '') AND OLD.created_at = NEW.created_at) BEGIN SELECT RAISE(ABORT, 'fixed asset immutable except one disposal transition'); END;--> statement-breakpoint
CREATE TRIGGER `fixed_assets_no_delete` BEFORE DELETE ON `fixed_assets` BEGIN SELECT RAISE(ABORT, 'fixed assets are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_components_no_update` BEFORE UPDATE ON `asset_components` BEGIN SELECT RAISE(ABORT, 'asset components are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_components_no_delete` BEFORE DELETE ON `asset_components` BEGIN SELECT RAISE(ABORT, 'asset components are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_depreciation_runs_no_update` BEFORE UPDATE ON `asset_depreciation_runs` BEGIN SELECT RAISE(ABORT, 'asset depreciation runs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_depreciation_runs_no_delete` BEFORE DELETE ON `asset_depreciation_runs` BEGIN SELECT RAISE(ABORT, 'asset depreciation runs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_depreciation_lines_no_update` BEFORE UPDATE ON `asset_depreciation_lines` BEGIN SELECT RAISE(ABORT, 'asset depreciation lines are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_depreciation_lines_no_delete` BEFORE DELETE ON `asset_depreciation_lines` BEGIN SELECT RAISE(ABORT, 'asset depreciation lines are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_tax_rule_snapshots_no_update` BEFORE UPDATE ON `asset_tax_rule_snapshots` BEGIN SELECT RAISE(ABORT, 'asset tax rule snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_tax_rule_snapshots_no_delete` BEFORE DELETE ON `asset_tax_rule_snapshots` BEGIN SELECT RAISE(ABORT, 'asset tax rule snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_tax_blocks_no_update` BEFORE UPDATE ON `asset_tax_blocks` BEGIN SELECT RAISE(ABORT, 'asset tax blocks are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_tax_blocks_no_delete` BEFORE DELETE ON `asset_tax_blocks` BEGIN SELECT RAISE(ABORT, 'asset tax blocks are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_tax_runs_no_update` BEFORE UPDATE ON `asset_tax_runs` BEGIN SELECT RAISE(ABORT, 'asset tax runs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_tax_runs_no_delete` BEFORE DELETE ON `asset_tax_runs` BEGIN SELECT RAISE(ABORT, 'asset tax runs are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_tax_run_lines_no_update` BEFORE UPDATE ON `asset_tax_run_lines` BEGIN SELECT RAISE(ABORT, 'asset tax run lines are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_tax_run_lines_no_delete` BEFORE DELETE ON `asset_tax_run_lines` BEGIN SELECT RAISE(ABORT, 'asset tax run lines are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_disposals_no_update` BEFORE UPDATE ON `asset_disposals` BEGIN SELECT RAISE(ABORT, 'asset disposals are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `asset_disposals_no_delete` BEFORE DELETE ON `asset_disposals` BEGIN SELECT RAISE(ABORT, 'asset disposals are immutable'); END;
