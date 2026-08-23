CREATE TABLE `expense_claimants` (
  `id` text PRIMARY KEY NOT NULL, `tenant_id` text NOT NULL, `book_set_id` text NOT NULL,
  `claimant_type` text NOT NULL, `display_name` text NOT NULL, `payroll_employee_id` text,
  `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`payroll_employee_id`,`tenant_id`,`book_set_id`) REFERENCES `payroll_employees`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_expense_claimant_type` CHECK(`expense_claimants`.`claimant_type` IN ('EMPLOYEE','DIRECTOR','PROPRIETOR','OWNER')),
  CONSTRAINT `chk_expense_claimant_name` CHECK(length(trim(`expense_claimants`.`display_name`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_claimants_scope_key` ON `expense_claimants` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_expense_claimants_scope` ON `expense_claimants` (`tenant_id`,`book_set_id`,`display_name`);
--> statement-breakpoint
CREATE TABLE `expense_claims` (
  `id` text PRIMARY KEY NOT NULL, `tenant_id` text NOT NULL, `book_set_id` text NOT NULL,
  `claimant_id` text NOT NULL, `creator_actor_id` text NOT NULL, `reimbursement_liability_account_id` text NOT NULL,
  `claim_date` text NOT NULL, `narration` text, `status` text NOT NULL,
  `business_total_minor` integer DEFAULT 0 NOT NULL, `submitted_at` text,
  `reviewer_actor_id` text, `review_observation` text, `allocation_confirmation_facts_json` text,
  `reviewed_at` text, `posted_at` text, `posted_journal_id` text, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`claimant_id`,`tenant_id`,`book_set_id`) REFERENCES `expense_claimants`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`reimbursement_liability_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`posted_journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_expense_claim_status` CHECK(`expense_claims`.`status` IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','PARTIALLY_SETTLED','SETTLED','CANCELLED')),
  CONSTRAINT `chk_expense_claim_date` CHECK(length(`expense_claims`.`claim_date`) = 10),
  CONSTRAINT `chk_expense_claim_business_total` CHECK(typeof(`expense_claims`.`business_total_minor`) = 'integer' AND `expense_claims`.`business_total_minor` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_claims_scope_key` ON `expense_claims` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_expense_claims_status` ON `expense_claims` (`tenant_id`,`book_set_id`,`status`,`claim_date`);
--> statement-breakpoint
CREATE TABLE `expense_claim_lines` (
  `id` text PRIMARY KEY NOT NULL, `tenant_id` text NOT NULL, `book_set_id` text NOT NULL, `claim_id` text NOT NULL,
  `line_number` integer NOT NULL, `description` text NOT NULL, `gross_minor` integer NOT NULL,
  `business_minor` integer NOT NULL, `personal_minor` integer NOT NULL, `expense_account_id` text NOT NULL,
  `evidence_id` text, `evidence_status` text NOT NULL, `explanation` text, `created_at` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`claim_id`,`tenant_id`,`book_set_id`) REFERENCES `expense_claims`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`expense_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_expense_claim_line_amounts` CHECK(typeof(`expense_claim_lines`.`gross_minor`) = 'integer' AND `expense_claim_lines`.`gross_minor` > 0 AND typeof(`expense_claim_lines`.`business_minor`) = 'integer' AND `expense_claim_lines`.`business_minor` >= 0 AND typeof(`expense_claim_lines`.`personal_minor`) = 'integer' AND `expense_claim_lines`.`personal_minor` >= 0 AND `expense_claim_lines`.`gross_minor` = `expense_claim_lines`.`business_minor` + `expense_claim_lines`.`personal_minor`),
  CONSTRAINT `chk_expense_claim_line_evidence_status` CHECK(`expense_claim_lines`.`evidence_status` IN ('ATTACHED','MISSING','EXPLANATION_ONLY','INVALID')),
  CONSTRAINT `chk_expense_claim_line_description` CHECK(length(trim(`expense_claim_lines`.`description`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_claim_lines_number` ON `expense_claim_lines` (`claim_id`,`line_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_claim_lines_scope_key` ON `expense_claim_lines` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_expense_claim_lines_evidence` ON `expense_claim_lines` (`tenant_id`,`book_set_id`,`evidence_status`);
--> statement-breakpoint
CREATE TABLE `expense_advances` (
  `id` text PRIMARY KEY NOT NULL, `tenant_id` text NOT NULL, `book_set_id` text NOT NULL, `claimant_id` text NOT NULL,
  `issue_date` text NOT NULL, `amount_minor` integer NOT NULL, `advance_asset_account_id` text NOT NULL, `bank_account_id` text NOT NULL,
  `status` text NOT NULL, `issued_journal_id` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`claimant_id`,`tenant_id`,`book_set_id`) REFERENCES `expense_claimants`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`advance_asset_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`bank_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`issued_journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_expense_advance_status` CHECK(`expense_advances`.`status` IN ('OPEN','PARTIALLY_SETTLED','SETTLED')),
  CONSTRAINT `chk_expense_advance_amount` CHECK(typeof(`expense_advances`.`amount_minor`) = 'integer' AND `expense_advances`.`amount_minor` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_expense_advances_scope_key` ON `expense_advances` (`id`,`tenant_id`,`book_set_id`);
--> statement-breakpoint
CREATE INDEX `idx_expense_advances_status` ON `expense_advances` (`tenant_id`,`book_set_id`,`status`,`issue_date`);
--> statement-breakpoint
CREATE TABLE `expense_advance_allocations` (
  `id` text PRIMARY KEY NOT NULL, `tenant_id` text NOT NULL, `book_set_id` text NOT NULL, `advance_id` text NOT NULL, `claim_id` text NOT NULL,
  `amount_minor` integer NOT NULL, `journal_id` text NOT NULL, `created_at` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`advance_id`,`tenant_id`,`book_set_id`) REFERENCES `expense_advances`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`claim_id`,`tenant_id`,`book_set_id`) REFERENCES `expense_claims`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_expense_advance_allocation_amount` CHECK(typeof(`expense_advance_allocations`.`amount_minor`) = 'integer' AND `expense_advance_allocations`.`amount_minor` > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_expense_advance_allocations_advance` ON `expense_advance_allocations` (`tenant_id`,`book_set_id`,`advance_id`);
--> statement-breakpoint
CREATE TABLE `expense_advance_repayments` (
  `id` text PRIMARY KEY NOT NULL, `tenant_id` text NOT NULL, `book_set_id` text NOT NULL, `advance_id` text NOT NULL,
  `amount_minor` integer NOT NULL, `bank_account_id` text NOT NULL, `journal_id` text NOT NULL, `created_at` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`advance_id`,`tenant_id`,`book_set_id`) REFERENCES `expense_advances`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`bank_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_expense_advance_repayment_amount` CHECK(typeof(`expense_advance_repayments`.`amount_minor`) = 'integer' AND `expense_advance_repayments`.`amount_minor` > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_expense_advance_repayments_advance` ON `expense_advance_repayments` (`tenant_id`,`book_set_id`,`advance_id`);
--> statement-breakpoint
CREATE TABLE `expense_reimbursements` (
  `id` text PRIMARY KEY NOT NULL, `tenant_id` text NOT NULL, `book_set_id` text NOT NULL, `claim_id` text NOT NULL,
  `amount_minor` integer NOT NULL, `bank_account_id` text NOT NULL, `journal_id` text NOT NULL, `created_at` text NOT NULL,
  FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`claim_id`,`tenant_id`,`book_set_id`) REFERENCES `expense_claims`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`bank_account_id`,`tenant_id`,`book_set_id`) REFERENCES `accounts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`journal_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_entries`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `chk_expense_reimbursement_amount` CHECK(typeof(`expense_reimbursements`.`amount_minor`) = 'integer' AND `expense_reimbursements`.`amount_minor` > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_expense_reimbursements_claim` ON `expense_reimbursements` (`tenant_id`,`book_set_id`,`claim_id`);
--> statement-breakpoint
CREATE TRIGGER `expense_claim_lines_no_update` BEFORE UPDATE ON `expense_claim_lines` BEGIN SELECT RAISE(ABORT, 'expense claim lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_claim_lines_no_delete` BEFORE DELETE ON `expense_claim_lines` BEGIN SELECT RAISE(ABORT, 'expense claim lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_claim_lines_no_insert_posted` BEFORE INSERT ON `expense_claim_lines` WHEN EXISTS (SELECT 1 FROM `expense_claims` WHERE `id` = NEW.`claim_id` AND `tenant_id` = NEW.`tenant_id` AND `book_set_id` = NEW.`book_set_id` AND `status` IN ('POSTED','PARTIALLY_SETTLED','SETTLED')) BEGIN SELECT RAISE(ABORT, 'posted expense claim lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_claims_posted_fields_immutable` BEFORE UPDATE ON `expense_claims` WHEN OLD.status IN ('POSTED','PARTIALLY_SETTLED','SETTLED') AND (NEW.tenant_id <> OLD.tenant_id OR NEW.book_set_id <> OLD.book_set_id OR NEW.claimant_id <> OLD.claimant_id OR NEW.creator_actor_id <> OLD.creator_actor_id OR NEW.reimbursement_liability_account_id <> OLD.reimbursement_liability_account_id OR NEW.claim_date <> OLD.claim_date OR COALESCE(NEW.narration,'') <> COALESCE(OLD.narration,'') OR NEW.business_total_minor <> OLD.business_total_minor OR COALESCE(NEW.posted_journal_id,'') <> COALESCE(OLD.posted_journal_id,'') OR COALESCE(NEW.posted_at,'') <> COALESCE(OLD.posted_at,'') OR COALESCE(NEW.reviewer_actor_id,'') <> COALESCE(OLD.reviewer_actor_id,'') OR COALESCE(NEW.review_observation,'') <> COALESCE(OLD.review_observation,'') OR COALESCE(NEW.allocation_confirmation_facts_json,'') <> COALESCE(OLD.allocation_confirmation_facts_json,'') OR COALESCE(NEW.submitted_at,'') <> COALESCE(OLD.submitted_at,'') OR COALESCE(NEW.reviewed_at,'') <> COALESCE(OLD.reviewed_at,'') OR NEW.created_at <> OLD.created_at) BEGIN SELECT RAISE(ABORT, 'posted expense claim fields are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_claims_posted_status_guard` BEFORE UPDATE ON `expense_claims` WHEN (OLD.status = 'POSTED' AND NEW.status NOT IN ('POSTED','PARTIALLY_SETTLED','SETTLED')) OR (OLD.status = 'PARTIALLY_SETTLED' AND NEW.status NOT IN ('PARTIALLY_SETTLED','SETTLED')) OR (OLD.status = 'SETTLED' AND NEW.status <> 'SETTLED') BEGIN SELECT RAISE(ABORT, 'posted expense claim status cannot regress'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_claims_no_delete_posted` BEFORE DELETE ON `expense_claims` WHEN OLD.status IN ('POSTED','PARTIALLY_SETTLED','SETTLED') BEGIN SELECT RAISE(ABORT, 'posted expense claims are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_advance_allocations_no_update` BEFORE UPDATE ON `expense_advance_allocations` BEGIN SELECT RAISE(ABORT, 'expense advance allocations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_advance_allocations_no_delete` BEFORE DELETE ON `expense_advance_allocations` BEGIN SELECT RAISE(ABORT, 'expense advance allocations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_advance_repayments_no_update` BEFORE UPDATE ON `expense_advance_repayments` BEGIN SELECT RAISE(ABORT, 'expense advance repayments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_advance_repayments_no_delete` BEFORE DELETE ON `expense_advance_repayments` BEGIN SELECT RAISE(ABORT, 'expense advance repayments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_reimbursements_no_update` BEFORE UPDATE ON `expense_reimbursements` BEGIN SELECT RAISE(ABORT, 'expense reimbursements are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `expense_reimbursements_no_delete` BEFORE DELETE ON `expense_reimbursements` BEGIN SELECT RAISE(ABORT, 'expense reimbursements are immutable'); END;
