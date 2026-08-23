CREATE TABLE `payroll_bank_export_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`preset_id` text NOT NULL,
	`csv_text` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_payment_batches`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preset_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_bank_export_presets`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_bank_export_artifact_hash" CHECK(length("payroll_bank_export_artifacts"."artifact_hash") = 64 AND "payroll_bank_export_artifacts"."artifact_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_bank_export_artifacts_batch_preset` ON `payroll_bank_export_artifacts` (`batch_id`,`preset_id`);--> statement-breakpoint
CREATE TABLE `payroll_bank_export_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`preset_code` text NOT NULL,
	`version` integer NOT NULL,
	`columns_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_bank_export_preset_code" CHECK("payroll_bank_export_presets"."preset_code" = 'GENERIC_NEFT')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_bank_export_presets_version` ON `payroll_bank_export_presets` (`tenant_id`,`book_set_id`,`preset_code`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_bank_export_presets_scope_key` ON `payroll_bank_export_presets` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `payroll_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`tax_year` text NOT NULL,
	`category` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`evidence_id` text NOT NULL,
	`status` text NOT NULL,
	`reviewer_id` text,
	`review_observation` text,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_employees`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_claim_status" CHECK("payroll_claims"."status" IN ('PENDING','APPROVED','REJECTED')),
	CONSTRAINT "chk_payroll_claim_amount" CHECK("payroll_claims"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_claims_scope_key` ON `payroll_claims` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_claims_status` ON `payroll_claims` (`tenant_id`,`book_set_id`,`employee_id`,`tax_year`,`status`);--> statement-breakpoint
CREATE TABLE `payroll_component_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`pay_run_employee_id` text NOT NULL,
	`component_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`calculation_facts_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pay_run_employee_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_pay_run_employees`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`component_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_salary_components`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_component_line_amount" CHECK("payroll_component_lines"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_component_lines_component` ON `payroll_component_lines` (`pay_run_employee_id`,`component_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_component_lines_run` ON `payroll_component_lines` (`tenant_id`,`book_set_id`,`pay_run_employee_id`);--> statement-breakpoint
CREATE TABLE `payroll_employee_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`profile_type` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`facts_json` text NOT NULL,
	`verification_status` text NOT NULL,
	`evidence_id` text,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_employees`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_employee_profile_type" CHECK("payroll_employee_profiles"."profile_type" IN ('TAX','STATUTORY')),
	CONSTRAINT "chk_payroll_employee_profile_status" CHECK("payroll_employee_profiles"."verification_status" IN ('UNVERIFIED','VERIFIED','REVIEW_REQUIRED')),
	CONSTRAINT "chk_payroll_employee_profile_dates" CHECK("payroll_employee_profiles"."effective_to" IS NULL OR "payroll_employee_profiles"."effective_to" > "payroll_employee_profiles"."effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_employee_profiles_scope_key` ON `payroll_employee_profiles` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_employee_profiles_hash` ON `payroll_employee_profiles` (`tenant_id`,`book_set_id`,`canonical_hash`);--> statement-breakpoint
CREATE INDEX `idx_payroll_employee_profiles_effective` ON `payroll_employee_profiles` (`tenant_id`,`book_set_id`,`employee_id`,`profile_type`,`effective_from`);--> statement-breakpoint
CREATE TABLE `payroll_employees` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`employee_code` text NOT NULL,
	`legal_name` text NOT NULL,
	`joining_date` text NOT NULL,
	`exit_date` text,
	`work_state` text NOT NULL,
	`work_location` text NOT NULL,
	`pan_last_four` text,
	`pan_fingerprint` text,
	`pan_verification_status` text NOT NULL,
	`uan_last_four` text,
	`uan_verification_status` text NOT NULL,
	`esic_last_four` text,
	`esic_verification_status` text NOT NULL,
	`bank_last_four` text,
	`bank_fingerprint` text,
	`bank_verification_status` text NOT NULL,
	`evidence_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_employee_verification_statuses" CHECK("payroll_employees"."pan_verification_status" IN ('UNVERIFIED','VERIFIED','REVIEW_REQUIRED') AND "payroll_employees"."uan_verification_status" IN ('NOT_APPLICABLE','UNVERIFIED','VERIFIED','REVIEW_REQUIRED') AND "payroll_employees"."esic_verification_status" IN ('NOT_APPLICABLE','UNVERIFIED','VERIFIED','REVIEW_REQUIRED') AND "payroll_employees"."bank_verification_status" IN ('UNVERIFIED','VERIFIED','REVIEW_REQUIRED')),
	CONSTRAINT "chk_payroll_employee_dates" CHECK("payroll_employees"."exit_date" IS NULL OR "payroll_employees"."exit_date" >= "payroll_employees"."joining_date"),
	CONSTRAINT "chk_payroll_employee_name" CHECK(length(trim("payroll_employees"."legal_name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_employees_code` ON `payroll_employees` (`tenant_id`,`book_set_id`,`employee_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_employees_scope_key` ON `payroll_employees` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_employees_scope` ON `payroll_employees` (`tenant_id`,`book_set_id`,`employee_code`);--> statement-breakpoint
CREATE TABLE `payroll_pay_run_employees` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`pay_run_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`salary_version_id` text NOT NULL,
	`payable_days` integer NOT NULL,
	`period_days` integer NOT NULL,
	`unpaid_leave_days` integer NOT NULL,
	`variable_facts_json` text NOT NULL,
	`gross_minor` integer DEFAULT 0 NOT NULL,
	`employee_deduction_minor` integer DEFAULT 0 NOT NULL,
	`employer_contribution_minor` integer DEFAULT 0 NOT NULL,
	`net_minor` integer DEFAULT 0 NOT NULL,
	`rule_ids_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pay_run_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_pay_runs`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_employees`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`salary_version_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_salary_versions`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_pay_run_employee_days" CHECK("payroll_pay_run_employees"."period_days" > 0 AND "payroll_pay_run_employees"."payable_days" >= 0 AND "payroll_pay_run_employees"."payable_days" <= "payroll_pay_run_employees"."period_days" AND "payroll_pay_run_employees"."unpaid_leave_days" >= 0 AND "payroll_pay_run_employees"."unpaid_leave_days" <= "payroll_pay_run_employees"."period_days"),
	CONSTRAINT "chk_payroll_pay_run_employee_amounts" CHECK("payroll_pay_run_employees"."gross_minor" >= 0 AND "payroll_pay_run_employees"."employee_deduction_minor" >= 0 AND "payroll_pay_run_employees"."employer_contribution_minor" >= 0 AND "payroll_pay_run_employees"."net_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_pay_run_employee` ON `payroll_pay_run_employees` (`pay_run_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_pay_run_employees_run` ON `payroll_pay_run_employees` (`tenant_id`,`book_set_id`,`pay_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_pay_run_employees_scope_key` ON `payroll_pay_run_employees` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `payroll_pay_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`payment_date` text NOT NULL,
	`status` text NOT NULL,
	`input_hash` text NOT NULL,
	`calculation_hash` text,
	`journal_id` text,
	`created_at` text NOT NULL,
	`approved_at` text,
	`posted_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_pay_run_status" CHECK("payroll_pay_runs"."status" IN ('PREPARED','APPROVED','POSTED','REVIEW_REQUIRED')),
	CONSTRAINT "chk_payroll_pay_run_dates" CHECK("payroll_pay_runs"."period_end" >= "payroll_pay_runs"."period_start" AND "payroll_pay_runs"."payment_date" >= "payroll_pay_runs"."period_end"),
	CONSTRAINT "chk_payroll_pay_run_fields" CHECK(("payroll_pay_runs"."status" IN ('PREPARED','REVIEW_REQUIRED') AND "payroll_pay_runs"."journal_id" IS NULL AND "payroll_pay_runs"."approved_at" IS NULL AND "payroll_pay_runs"."posted_at" = '') OR ("payroll_pay_runs"."status" = 'APPROVED' AND "payroll_pay_runs"."journal_id" IS NULL AND "payroll_pay_runs"."approved_at" IS NOT NULL AND "payroll_pay_runs"."posted_at" = '') OR ("payroll_pay_runs"."status" = 'POSTED' AND "payroll_pay_runs"."journal_id" IS NOT NULL AND "payroll_pay_runs"."approved_at" IS NOT NULL AND "payroll_pay_runs"."posted_at" <> ''))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_pay_runs_scope_key` ON `payroll_pay_runs` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_pay_runs_period` ON `payroll_pay_runs` (`tenant_id`,`book_set_id`,`period_start`,`period_end`,`payment_date`);--> statement-breakpoint
CREATE INDEX `idx_payroll_pay_runs_status` ON `payroll_pay_runs` (`tenant_id`,`book_set_id`,`status`,`payment_date`);--> statement-breakpoint
CREATE TABLE `payroll_payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`pay_run_employee_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_payment_batches`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pay_run_employee_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_pay_run_employees`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_payment_allocation_amount" CHECK("payroll_payment_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_payment_allocations_employee` ON `payroll_payment_allocations` (`batch_id`,`pay_run_employee_id`);--> statement-breakpoint
CREATE TABLE `payroll_payment_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`payment_date` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`journal_id` text,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bank_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_payment_batch_status" CHECK("payroll_payment_batches"."status" IN ('PREPARED','POSTED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_payment_batches_scope_key` ON `payroll_payment_batches` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `payroll_payslips` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`pay_run_employee_id` text NOT NULL,
	`payslip_number` text NOT NULL,
	`rendered_text` text NOT NULL,
	`rendered_html` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pay_run_employee_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_pay_run_employees`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_payslip_hash" CHECK(length("payroll_payslips"."evidence_hash") = 64 AND "payroll_payslips"."evidence_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_payslips_number` ON `payroll_payslips` (`tenant_id`,`book_set_id`,`payslip_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_payslips_run_employee` ON `payroll_payslips` (`pay_run_employee_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_payslips_run` ON `payroll_payslips` (`tenant_id`,`book_set_id`,`pay_run_employee_id`);--> statement-breakpoint
CREATE TABLE `payroll_remittance_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`remittance_id` text NOT NULL,
	`pay_run_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`remittance_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_remittances`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pay_run_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_pay_runs`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_remittance_allocation_amount" CHECK("payroll_remittance_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_remittance_allocations_run` ON `payroll_remittance_allocations` (`remittance_id`,`pay_run_id`);--> statement-breakpoint
CREATE TABLE `payroll_remittances` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`rule_type` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`liability_account_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`status` text NOT NULL,
	`evidence_id` text,
	`observation` text,
	`created_at` text NOT NULL,
	`journal_id` text,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`liability_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_remittance_type" CHECK("payroll_remittances"."rule_type" IN ('SALARY_TDS','EPF','ESI','PT','LWF')),
	CONSTRAINT "chk_payroll_remittance_status" CHECK("payroll_remittances"."status" IN ('PREPARED','EXPORTED','SUBMITTED','ACKNOWLEDGED','REJECTED')),
	CONSTRAINT "chk_payroll_remittance_amount" CHECK("payroll_remittances"."amount_minor" > 0),
	CONSTRAINT "chk_payroll_remittance_acknowledged" CHECK("payroll_remittances"."status" <> 'ACKNOWLEDGED' OR "payroll_remittances"."evidence_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_remittances_scope_key` ON `payroll_remittances` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_remittances_period` ON `payroll_remittances` (`tenant_id`,`book_set_id`,`rule_type`,`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `payroll_rule_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`rule_type` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`official_source` text NOT NULL,
	`law_reference` text NOT NULL,
	`rule_version` text NOT NULL,
	`applicability_facts_json` text NOT NULL,
	`rate_bps` integer,
	`cap_minor` integer,
	`basis` text NOT NULL,
	`rounding` text NOT NULL,
	`status` text NOT NULL,
	`salary_tds_facts_json` text,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_rule_snapshot_type" CHECK("payroll_rule_snapshots"."rule_type" IN ('SALARY_TDS','EPF','ESI','PT','LWF')),
	CONSTRAINT "chk_payroll_rule_snapshot_status" CHECK("payroll_rule_snapshots"."status" IN ('VERIFIED','UNVERIFIED','TENTATIVE')),
	CONSTRAINT "chk_payroll_rule_snapshot_basis" CHECK("payroll_rule_snapshots"."basis" IN ('GROSS','NAMED_COMPONENT','TAXABLE_INCOME','FIXED')),
	CONSTRAINT "chk_payroll_rule_snapshot_rounding" CHECK("payroll_rule_snapshots"."rounding" IN ('PAISE_HALF_UP','PAISE_DOWN','PAISE_UP')),
	CONSTRAINT "chk_payroll_rule_snapshot_dates" CHECK("payroll_rule_snapshots"."effective_to" IS NULL OR "payroll_rule_snapshots"."effective_to" > "payroll_rule_snapshots"."effective_from"),
	CONSTRAINT "chk_payroll_rule_snapshot_rate" CHECK("payroll_rule_snapshots"."rate_bps" IS NULL OR ("payroll_rule_snapshots"."rate_bps" >= 0 AND "payroll_rule_snapshots"."rate_bps" <= 100000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_rule_snapshots_hash` ON `payroll_rule_snapshots` (`tenant_id`,`book_set_id`,`canonical_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_rule_snapshots_scope_key` ON `payroll_rule_snapshots` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_rule_snapshots_effective` ON `payroll_rule_snapshots` (`tenant_id`,`book_set_id`,`jurisdiction`,`rule_type`,`effective_from`);--> statement-breakpoint
CREATE TABLE `payroll_salary_components` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`version_id` text NOT NULL,
	`component_code` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`basis_type` text NOT NULL,
	`fixed_minor` integer,
	`rate_bps` integer,
	`basis_component_code` text,
	`expense_account_id` text,
	`payable_account_id` text,
	`liability_account_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_salary_versions`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`expense_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payable_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`liability_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_salary_component_kind" CHECK("payroll_salary_components"."kind" IN ('EARNING','EMPLOYEE_DEDUCTION','EMPLOYER_CONTRIBUTION','INFORMATIONAL')),
	CONSTRAINT "chk_payroll_salary_component_basis" CHECK(("payroll_salary_components"."basis_type" = 'FIXED_MINOR' AND "payroll_salary_components"."fixed_minor" IS NOT NULL AND "payroll_salary_components"."fixed_minor" >= 0 AND "payroll_salary_components"."rate_bps" IS NULL AND "payroll_salary_components"."basis_component_code" IS NULL) OR ("payroll_salary_components"."basis_type" = 'RATE_BPS' AND "payroll_salary_components"."rate_bps" IS NOT NULL AND "payroll_salary_components"."rate_bps" >= 0 AND "payroll_salary_components"."rate_bps" <= 100000 AND "payroll_salary_components"."fixed_minor" IS NULL AND "payroll_salary_components"."basis_component_code" IS NOT NULL)),
	CONSTRAINT "chk_payroll_salary_component_accounts" CHECK(("payroll_salary_components"."kind" = 'EARNING' AND "payroll_salary_components"."expense_account_id" IS NOT NULL) OR ("payroll_salary_components"."kind" = 'EMPLOYER_CONTRIBUTION' AND "payroll_salary_components"."expense_account_id" IS NOT NULL AND "payroll_salary_components"."liability_account_id" IS NOT NULL) OR ("payroll_salary_components"."kind" = 'EMPLOYEE_DEDUCTION' AND "payroll_salary_components"."liability_account_id" IS NOT NULL) OR "payroll_salary_components"."kind" = 'INFORMATIONAL')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_salary_components_code` ON `payroll_salary_components` (`version_id`,`component_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_salary_components_scope_key` ON `payroll_salary_components` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_components_version` ON `payroll_salary_components` (`tenant_id`,`book_set_id`,`version_id`,`component_code`);--> statement-breakpoint
CREATE TABLE `payroll_salary_structures` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_salary_structures_name` ON `payroll_salary_structures` (`tenant_id`,`book_set_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_salary_structures_scope_key` ON `payroll_salary_structures` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TABLE `payroll_salary_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`structure_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`proration_policy` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`structure_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_salary_structures`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_payroll_salary_version_proration" CHECK("payroll_salary_versions"."proration_policy" IN ('NONE','PAYABLE_DAYS_OVER_PERIOD_DAYS','CALENDAR_DAYS')),
	CONSTRAINT "chk_payroll_salary_version_dates" CHECK("payroll_salary_versions"."effective_to" IS NULL OR "payroll_salary_versions"."effective_to" > "payroll_salary_versions"."effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_salary_versions_number` ON `payroll_salary_versions` (`structure_id`,`version_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_salary_versions_scope_key` ON `payroll_salary_versions` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_salary_versions_hash` ON `payroll_salary_versions` (`tenant_id`,`book_set_id`,`canonical_hash`);--> statement-breakpoint
CREATE INDEX `idx_payroll_salary_versions_effective` ON `payroll_salary_versions` (`tenant_id`,`book_set_id`,`structure_id`,`effective_from`);
--> statement-breakpoint
CREATE TRIGGER `payroll_employee_profiles_no_overlap` BEFORE INSERT ON `payroll_employee_profiles` BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM payroll_employee_profiles p WHERE p.tenant_id = NEW.tenant_id AND p.book_set_id = NEW.book_set_id AND p.employee_id = NEW.employee_id AND p.profile_type = NEW.profile_type AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31') AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from) THEN RAISE(ABORT, 'overlapping payroll employee profile') END; END;
--> statement-breakpoint
CREATE TRIGGER `payroll_employee_profiles_no_overlap_upd` BEFORE UPDATE ON `payroll_employee_profiles` BEGIN SELECT RAISE(ABORT, 'payroll employee profiles are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_salary_versions_no_overlap` BEFORE INSERT ON `payroll_salary_versions` BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM payroll_salary_versions v WHERE v.tenant_id = NEW.tenant_id AND v.book_set_id = NEW.book_set_id AND v.structure_id = NEW.structure_id AND v.effective_from <= COALESCE(NEW.effective_to, '9999-12-31') AND COALESCE(v.effective_to, '9999-12-31') >= NEW.effective_from) THEN RAISE(ABORT, 'overlapping payroll salary version') END; END;
--> statement-breakpoint
CREATE TRIGGER `payroll_salary_versions_no_overlap_upd` BEFORE UPDATE ON `payroll_salary_versions` BEGIN SELECT RAISE(ABORT, 'payroll salary versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_rule_snapshots_no_overlap` BEFORE INSERT ON `payroll_rule_snapshots` BEGIN SELECT CASE WHEN EXISTS (SELECT 1 FROM payroll_rule_snapshots r WHERE r.tenant_id = NEW.tenant_id AND r.book_set_id = NEW.book_set_id AND r.jurisdiction = NEW.jurisdiction AND r.rule_type = NEW.rule_type AND r.effective_from <= COALESCE(NEW.effective_to, '9999-12-31') AND COALESCE(r.effective_to, '9999-12-31') >= NEW.effective_from) THEN RAISE(ABORT, 'overlapping payroll rule snapshot') END; END;
--> statement-breakpoint
CREATE TRIGGER `payroll_rule_snapshots_no_update` BEFORE UPDATE ON `payroll_rule_snapshots` BEGIN SELECT RAISE(ABORT, 'payroll rule snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_rule_snapshots_no_delete` BEFORE DELETE ON `payroll_rule_snapshots` BEGIN SELECT RAISE(ABORT, 'payroll rule snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_claims_no_delete` BEFORE DELETE ON `payroll_claims` BEGIN SELECT RAISE(ABORT, 'payroll claims are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_payslips_no_update` BEFORE UPDATE ON `payroll_payslips` BEGIN SELECT RAISE(ABORT, 'payroll payslips are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_payslips_no_delete` BEFORE DELETE ON `payroll_payslips` BEGIN SELECT RAISE(ABORT, 'payroll payslips are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_pay_runs_posted_immutable` BEFORE UPDATE ON `payroll_pay_runs` WHEN OLD.status = 'POSTED' BEGIN SELECT RAISE(ABORT, 'posted payroll pay runs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_pay_run_employees_no_update` BEFORE UPDATE ON `payroll_pay_run_employees` WHEN EXISTS (SELECT 1 FROM payroll_pay_runs r WHERE r.id = OLD.pay_run_id AND r.tenant_id = OLD.tenant_id AND r.book_set_id = OLD.book_set_id AND r.status = 'POSTED') BEGIN SELECT RAISE(ABORT, 'posted payroll run employees are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_pay_run_employees_no_delete` BEFORE DELETE ON `payroll_pay_run_employees` BEGIN SELECT RAISE(ABORT, 'payroll run employees are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_component_lines_no_update` BEFORE UPDATE ON `payroll_component_lines` WHEN EXISTS (SELECT 1 FROM payroll_pay_run_employees e JOIN payroll_pay_runs r ON r.id = e.pay_run_id AND r.tenant_id = e.tenant_id AND r.book_set_id = e.book_set_id WHERE e.id = OLD.pay_run_employee_id AND e.tenant_id = OLD.tenant_id AND e.book_set_id = OLD.book_set_id AND r.status = 'POSTED') BEGIN SELECT RAISE(ABORT, 'posted payroll component lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_component_lines_no_delete` BEFORE DELETE ON `payroll_component_lines` BEGIN SELECT RAISE(ABORT, 'payroll component lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_employee_profiles_no_delete` BEFORE DELETE ON `payroll_employee_profiles` BEGIN SELECT RAISE(ABORT, 'payroll employee profiles are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `payroll_pay_runs_no_delete` BEFORE DELETE ON `payroll_pay_runs` BEGIN SELECT RAISE(ABORT, 'payroll pay runs are immutable'); END;
