CREATE TABLE `source_import_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`source_id` text NOT NULL,
	`event_type` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`reason` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`details_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`,`tenant_id`,`book_set_id`) REFERENCES `source_registrations`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_source_import_events_type" CHECK("source_import_events"."event_type" IN ('PREVIEWED', 'IMPORTED', 'REJECTED')),
	CONSTRAINT "chk_source_import_events_hash" CHECK(length("source_import_events"."request_hash") = 64 AND "source_import_events"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_source_import_events_actor" CHECK("source_import_events"."actor_kind" IN ('HUMAN', 'AGENT', 'SYSTEM') AND length(trim("source_import_events"."actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_import_events_request` ON `source_import_events` (`tenant_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_import_events_scope_id` ON `source_import_events` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_source_import_events_source_created` ON `source_import_events` (`tenant_id`,`book_set_id`,`source_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `source_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_locator` text NOT NULL,
	`media_type` text NOT NULL,
	`encoding` text NOT NULL,
	`parser_id` text NOT NULL,
	`parser_version` text NOT NULL,
	`schema_fingerprint` text NOT NULL,
	`header_fingerprint` text NOT NULL,
	`row_count` integer NOT NULL,
	`source_period_start` text NOT NULL,
	`source_period_end` text NOT NULL,
	`masked_entity_identity` text NOT NULL,
	`masked_account_identity` text NOT NULL,
	`authority_state` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_kind` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_source_registrations_content_hash" CHECK(length("source_registrations"."content_hash") = 64 AND "source_registrations"."content_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_source_registrations_fingerprints" CHECK(length("source_registrations"."schema_fingerprint") = 64 AND "source_registrations"."schema_fingerprint" NOT GLOB '*[^0-9a-f]*' AND length("source_registrations"."header_fingerprint") = 64 AND "source_registrations"."header_fingerprint" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_source_registrations_row_count" CHECK(typeof("source_registrations"."row_count") = 'integer' AND "source_registrations"."row_count" >= 0),
	CONSTRAINT "chk_source_registrations_authority" CHECK("source_registrations"."authority_state" IN ('PRIMARY', 'DERIVED', 'UNVERIFIED')),
	CONSTRAINT "chk_source_registrations_actor" CHECK("source_registrations"."created_by_actor_kind" IN ('HUMAN', 'AGENT', 'SYSTEM') AND length(trim("source_registrations"."created_by_actor_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_registrations_scope_content_parser` ON `source_registrations` (`tenant_id`,`book_set_id`,`content_hash`,`parser_id`,`parser_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_registrations_scope_id` ON `source_registrations` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_source_registrations_scope_created` ON `source_registrations` (`tenant_id`,`book_set_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER `source_registrations_no_update` BEFORE UPDATE ON `source_registrations` BEGIN SELECT RAISE(ABORT, 'source registrations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_registrations_no_delete` BEFORE DELETE ON `source_registrations` BEGIN SELECT RAISE(ABORT, 'source registrations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_import_events_no_update` BEFORE UPDATE ON `source_import_events` BEGIN SELECT RAISE(ABORT, 'source import events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `source_import_events_no_delete` BEFORE DELETE ON `source_import_events` BEGIN SELECT RAISE(ABORT, 'source import events are immutable'); END;
