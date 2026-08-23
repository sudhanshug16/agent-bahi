CREATE TABLE `tax_case_fact_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`fact_id`,`tenant_id`,`tax_case_id`) REFERENCES `tax_case_facts`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_fact_event_type" CHECK("tax_case_fact_events"."event_type" IN ('PROPOSED', 'HUMAN_CONFIRMED', 'REJECTED')),
	CONSTRAINT "chk_tax_case_fact_event_actor" CHECK(length(trim(actor_id)) > 0 AND (event_type = 'PROPOSED' OR actor_kind = 'HUMAN')),
	CONSTRAINT "chk_tax_case_fact_event_hash" CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_fact_events_request` ON `tax_case_fact_events` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_tax_case_fact_events_fact` ON `tax_case_fact_events` (`tenant_id`,`tax_case_id`,`fact_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `tax_case_fact_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`journal_line_id` text NOT NULL,
	`allocated_amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`reason` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`fact_id`,`tenant_id`,`tax_case_id`) REFERENCES `tax_case_facts`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_line_id`,`tenant_id`,`book_set_id`) REFERENCES `journal_lines`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_fact_reconciliation_amount" CHECK(typeof(allocated_amount_minor) = 'integer' AND allocated_amount_minor > 0),
	CONSTRAINT "chk_tax_case_fact_reconciliation_currency" CHECK(length(currency) = 3 AND currency = upper(currency)),
	CONSTRAINT "chk_tax_case_fact_reconciliation_actor" CHECK("tax_case_fact_reconciliations"."actor_kind" = 'HUMAN' AND length(trim(actor_id)) > 0),
	CONSTRAINT "chk_tax_case_fact_reconciliation_hash" CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_fact_reconciliations_request` ON `tax_case_fact_reconciliations` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `idx_tax_case_fact_reconciliations_fact` ON `tax_case_fact_reconciliations` (`tenant_id`,`tax_case_id`,`fact_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_tax_case_fact_reconciliations_target` ON `tax_case_fact_reconciliations` (`tenant_id`,`book_set_id`,`journal_line_id`);--> statement-breakpoint
CREATE TABLE `tax_case_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tax_case_id` text NOT NULL,
	`source_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`source_record_key` text,
	`source_ordinal` integer,
	`kind` text NOT NULL,
	`raw_source_label` text NOT NULL,
	`raw_source_locator` text NOT NULL,
	`event_date` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`original_currency` text NOT NULL,
	`gross_amount_minor` integer NOT NULL,
	`tax_amount_minor` integer,
	`counterparty_display_json` text,
	`parser_identity` text NOT NULL,
	`parser_version` text NOT NULL,
	`provenance_json` text NOT NULL,
	`normalized_payload_hash` text NOT NULL,
	`supersedes_fact_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`,`tax_case_id`,`tenant_id`) REFERENCES `tax_case_external_sources`(`id`,`tax_case_id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`,`tenant_id`) REFERENCES `personal_tax_source_artifacts`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_fact_id`,`tenant_id`,`tax_case_id`) REFERENCES `tax_case_facts`(`id`,`tenant_id`,`tax_case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tax_case_fact_kind" CHECK("tax_case_facts"."kind" IN ('TDS_CREDIT', 'TCS_CREDIT', 'TAX_PAYMENT', 'BUSINESS_RECEIPT', 'INTEREST_INCOME', 'DIVIDEND_INCOME', 'SECURITIES_TRANSACTION', 'RENT_INCOME', 'OTHER')),
	CONSTRAINT "chk_tax_case_fact_identity" CHECK(((source_record_key IS NOT NULL AND length(trim(source_record_key)) > 0 AND source_ordinal IS NULL) OR (source_record_key IS NULL AND source_ordinal IS NOT NULL AND typeof(source_ordinal) = 'integer' AND source_ordinal >= 0))),
	CONSTRAINT "chk_tax_case_fact_amounts" CHECK(typeof(gross_amount_minor) = 'integer' AND gross_amount_minor >= 0 AND (tax_amount_minor IS NULL OR (typeof(tax_amount_minor) = 'integer' AND tax_amount_minor >= 0))),
	CONSTRAINT "chk_tax_case_fact_payload_hash" CHECK(length(normalized_payload_hash) = 64 AND normalized_payload_hash NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_tax_case_fact_currency" CHECK(length(original_currency) = 3 AND original_currency = upper(original_currency))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_fact_source_payload` ON `tax_case_facts` (`tenant_id`,`tax_case_id`,`source_id`,`artifact_id`,`source_record_key`,`source_ordinal`,`normalized_payload_hash`);--> statement-breakpoint
CREATE INDEX `idx_tax_case_facts_case` ON `tax_case_facts` (`tenant_id`,`tax_case_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_tax_case_facts_source_key` ON `tax_case_facts` (`tenant_id`,`source_id`,`source_record_key`,`source_ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_journal_lines_id_tenant_book_set_v1` ON `journal_lines` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_case_facts_id_scope` ON `tax_case_facts` (`id`,`tenant_id`,`tax_case_id`);--> statement-breakpoint
CREATE TRIGGER `tax_case_facts_no_update` BEFORE UPDATE ON `tax_case_facts` BEGIN SELECT RAISE(ABORT, 'tax case facts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_facts_no_delete` BEFORE DELETE ON `tax_case_facts` BEGIN SELECT RAISE(ABORT, 'tax case facts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_fact_events_no_update` BEFORE UPDATE ON `tax_case_fact_events` BEGIN SELECT RAISE(ABORT, 'tax case fact events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_fact_events_no_delete` BEFORE DELETE ON `tax_case_fact_events` BEGIN SELECT RAISE(ABORT, 'tax case fact events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_fact_reconciliations_no_update` BEFORE UPDATE ON `tax_case_fact_reconciliations` BEGIN SELECT RAISE(ABORT, 'tax case fact reconciliations are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_fact_reconciliations_no_delete` BEFORE DELETE ON `tax_case_fact_reconciliations` BEGIN SELECT RAISE(ABORT, 'tax case fact reconciliations are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_fact_reconciliations_confirmed_only` BEFORE INSERT ON `tax_case_fact_reconciliations`
WHEN NOT EXISTS (SELECT 1 FROM tax_case_fact_events e WHERE e.fact_id = NEW.fact_id AND e.tenant_id = NEW.tenant_id AND e.tax_case_id = NEW.tax_case_id AND e.event_type = 'HUMAN_CONFIRMED')
BEGIN SELECT RAISE(ABORT, 'only human-confirmed tax facts may be reconciled'); END;--> statement-breakpoint
CREATE TRIGGER `tax_case_fact_reconciliations_no_overallocation` BEFORE INSERT ON `tax_case_fact_reconciliations`
WHEN NEW.allocated_amount_minor > (SELECT f.gross_amount_minor - COALESCE((SELECT SUM(r.allocated_amount_minor) FROM tax_case_fact_reconciliations r WHERE r.fact_id = NEW.fact_id AND r.tenant_id = NEW.tenant_id AND r.tax_case_id = NEW.tax_case_id), 0) FROM tax_case_facts f WHERE f.id = NEW.fact_id AND f.tenant_id = NEW.tenant_id AND f.tax_case_id = NEW.tax_case_id)
BEGIN SELECT RAISE(ABORT, 'tax fact reconciliation exceeds gross amount'); END;
