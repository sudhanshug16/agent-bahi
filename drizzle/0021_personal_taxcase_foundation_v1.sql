CREATE TABLE `book_set_ledger_revisions` (
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`tenant_id`, `book_set_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_book_set_ledger_revision" CHECK(typeof("book_set_ledger_revisions"."revision") = 'integer' AND "book_set_ledger_revisions"."revision" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_book_set_ledger_revisions_book_set` ON `book_set_ledger_revisions` (`tenant_id`,`book_set_id`);
--> statement-breakpoint
INSERT INTO `book_set_ledger_revisions` (`tenant_id`, `book_set_id`, `revision`)
SELECT bs.tenant_id, bs.id, COALESCE((SELECT COUNT(*) FROM journal_entries je WHERE je.tenant_id = bs.tenant_id AND je.book_set_id = bs.id AND je.status = 'POSTED'), 0)
FROM book_sets bs;
--> statement-breakpoint
CREATE TABLE `tax_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`financial_year` text NOT NULL,
	`tax_period` text NOT NULL,
	`filing_trigger` text NOT NULL,
	`case_sequence` integer DEFAULT 1 NOT NULL,
	`lifecycle` text DEFAULT 'OPEN' NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`result_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_lifecycle" CHECK("tax_cases"."lifecycle" IN ('OPEN', 'ARCHIVED')),
	CONSTRAINT "chk_tax_case_sequence" CHECK(typeof("tax_cases"."case_sequence") = 'integer' AND "tax_cases"."case_sequence" >= 1),
	CONSTRAINT "chk_tax_case_fields" CHECK(length(trim("tax_cases"."financial_year")) > 0 AND length(trim("tax_cases"."tax_period")) > 0 AND length(trim("tax_cases"."filing_trigger")) > 0),
	CONSTRAINT "chk_tax_case_hashes" CHECK(length("tax_cases"."request_hash") = 64 AND "tax_cases"."request_hash" NOT GLOB '*[^0-9a-f]*' AND length("tax_cases"."result_hash") = 64 AND "tax_cases"."result_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_cases_id_tenant` ON `tax_cases` (`id`,`tenant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_cases_identity` ON `tax_cases` (`tenant_id`,`financial_year`,`tax_period`,`filing_trigger`,`case_sequence`);
--> statement-breakpoint
CREATE INDEX `idx_tax_cases_tenant` ON `tax_cases` (`tenant_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TABLE `tax_case_membership_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_case_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`version` integer NOT NULL,
	`membership_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`tax_case_id`,`tenant_id`) REFERENCES `tax_cases`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_membership_version" CHECK(typeof("tax_case_membership_versions"."version") = 'integer' AND "tax_case_membership_versions"."version" >= 1),
	CONSTRAINT "chk_tax_case_membership_hash" CHECK(length("tax_case_membership_versions"."membership_hash") = 64 AND "tax_case_membership_versions"."membership_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_membership_versions_case_version` ON `tax_case_membership_versions` (`tax_case_id`,`tenant_id`,`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_membership_versions_id_scope` ON `tax_case_membership_versions` (`id`,`tax_case_id`,`tenant_id`);
--> statement-breakpoint
CREATE INDEX `idx_tax_case_membership_versions_case` ON `tax_case_membership_versions` (`tenant_id`,`tax_case_id`,`version`);
--> statement-breakpoint
CREATE TABLE `tax_case_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`tax_case_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`membership_version_id` text NOT NULL,
	`version` integer NOT NULL,
	`book_set_id` text NOT NULL,
	`ledger_revision` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`membership_version_id`,`tax_case_id`,`tenant_id`) REFERENCES `tax_case_membership_versions`(`id`,`tax_case_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tax_case_id`,`tenant_id`,`version`) REFERENCES `tax_case_membership_versions`(`tax_case_id`,`tenant_id`,`version`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`,`book_set_id`) REFERENCES `book_set_ledger_revisions`(`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_membership_row_version" CHECK(typeof("tax_case_memberships"."version") = 'integer' AND "tax_case_memberships"."version" >= 1),
	CONSTRAINT "chk_tax_case_membership_ledger_revision" CHECK(typeof("tax_case_memberships"."ledger_revision") = 'integer' AND "tax_case_memberships"."ledger_revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_membership_book_set` ON `tax_case_memberships` (`tax_case_id`,`tenant_id`,`version`,`book_set_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_membership_id_scope` ON `tax_case_memberships` (`id`,`tax_case_id`,`tenant_id`);
--> statement-breakpoint
CREATE INDEX `idx_tax_case_memberships_case` ON `tax_case_memberships` (`tenant_id`,`tax_case_id`,`version`,`book_set_id`);
--> statement-breakpoint
CREATE TRIGGER `book_sets_ledger_revision_init` AFTER INSERT ON `book_sets`
BEGIN
  INSERT INTO book_set_ledger_revisions (tenant_id, book_set_id, revision) VALUES (NEW.tenant_id, NEW.id, 0);
END;
--> statement-breakpoint
CREATE TRIGGER `journal_entries_ledger_revision_advance` AFTER INSERT ON `journal_entries`
WHEN NEW.status = 'POSTED'
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM book_set_ledger_revisions WHERE tenant_id = NEW.tenant_id AND book_set_id = NEW.book_set_id)
    THEN RAISE(ABORT, 'missing BookSet ledger revision authority') END;
  UPDATE book_set_ledger_revisions SET revision = revision + 1
    WHERE tenant_id = NEW.tenant_id AND book_set_id = NEW.book_set_id;
END;
--> statement-breakpoint
CREATE TRIGGER `tax_cases_no_delete` BEFORE DELETE ON `tax_cases`
BEGIN SELECT RAISE(ABORT, 'tax cases are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `tax_case_membership_versions_no_update` BEFORE UPDATE ON `tax_case_membership_versions`
BEGIN SELECT RAISE(ABORT, 'tax case membership versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `tax_case_membership_versions_no_delete` BEFORE DELETE ON `tax_case_membership_versions`
BEGIN SELECT RAISE(ABORT, 'tax case membership versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `tax_case_memberships_no_update` BEFORE UPDATE ON `tax_case_memberships`
BEGIN SELECT RAISE(ABORT, 'tax case memberships are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `tax_case_memberships_no_delete` BEFORE DELETE ON `tax_case_memberships`
BEGIN SELECT RAISE(ABORT, 'tax case memberships are immutable'); END;
