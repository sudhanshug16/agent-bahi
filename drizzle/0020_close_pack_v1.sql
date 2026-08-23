CREATE TABLE `close_pack_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`as_of_date` text NOT NULL,
	`basis` text NOT NULL,
	`manifest_format` text NOT NULL,
	`schema_version` integer NOT NULL,
	`period_close_state_hash` text NOT NULL,
	`period_close_label` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`government_compatible` integer NOT NULL,
	`submitted` integer NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`result_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_close_pack_manifest_dates" CHECK(length("close_pack_manifests"."period_start") = 10 AND length("close_pack_manifests"."period_end") = 10 AND length("close_pack_manifests"."as_of_date") = 10 AND "close_pack_manifests"."period_start" <= "close_pack_manifests"."period_end"),
	CONSTRAINT "chk_close_pack_manifest_basis" CHECK("close_pack_manifests"."basis" = 'ACCRUAL'),
	CONSTRAINT "chk_close_pack_manifest_format" CHECK("close_pack_manifests"."manifest_format" = 'NEUTRAL_CA_CLOSE_PACK_V1'),
	CONSTRAINT "chk_close_pack_manifest_version" CHECK("close_pack_manifests"."schema_version" = 1),
	CONSTRAINT "chk_close_pack_manifest_label" CHECK("close_pack_manifests"."period_close_label" IN ('OPEN', 'CLOSED', 'REOPENED')),
	CONSTRAINT "chk_close_pack_manifest_hashes" CHECK(length("close_pack_manifests"."period_close_state_hash") = 64 AND "close_pack_manifests"."period_close_state_hash" NOT GLOB '*[^0-9a-f]*' AND length("close_pack_manifests"."manifest_hash") = 64 AND "close_pack_manifests"."manifest_hash" NOT GLOB '*[^0-9a-f]*' AND length("close_pack_manifests"."request_hash") = 64 AND "close_pack_manifests"."request_hash" NOT GLOB '*[^0-9a-f]*' AND length("close_pack_manifests"."result_hash") = 64 AND "close_pack_manifests"."result_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_close_pack_manifest_boolean" CHECK("close_pack_manifests"."government_compatible" IN (0, 1) AND "close_pack_manifests"."submitted" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `close_pack_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`manifest_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`section_name` text NOT NULL,
	`row_count` integer NOT NULL,
	`body_hash` text NOT NULL,
	`body_size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`manifest_id`,`tenant_id`,`book_set_id`) REFERENCES `close_pack_manifests`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_close_pack_section_counts" CHECK("close_pack_sections"."row_count" >= 0 AND "close_pack_sections"."body_size_bytes" >= 0),
	CONSTRAINT "chk_close_pack_section_hash" CHECK(length("close_pack_sections"."body_hash") = 64 AND "close_pack_sections"."body_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `close_pack_bodies` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`manifest_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`csv_body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`section_id`,`manifest_id`,`tenant_id`,`book_set_id`) REFERENCES `close_pack_sections`(`id`,`manifest_id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_close_pack_body_nonempty" CHECK(length("close_pack_bodies"."csv_body") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_close_pack_manifest_request` ON `close_pack_manifests` (`tenant_id`,`book_set_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_close_pack_manifest_scope_key` ON `close_pack_manifests` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_close_pack_manifests_scope_period` ON `close_pack_manifests` (`tenant_id`,`book_set_id`,`period_start`,`period_end`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_close_pack_section_name` ON `close_pack_sections` (`manifest_id`,`section_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_close_pack_section_scope_key` ON `close_pack_sections` (`id`,`manifest_id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_close_pack_sections_manifest` ON `close_pack_sections` (`manifest_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_close_pack_body_section` ON `close_pack_bodies` (`section_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_close_pack_body_scope_key` ON `close_pack_bodies` (`id`,`section_id`,`manifest_id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE TRIGGER `close_pack_manifests_no_update` BEFORE UPDATE ON `close_pack_manifests` BEGIN SELECT RAISE(ABORT, 'close pack manifests are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `close_pack_manifests_no_delete` BEFORE DELETE ON `close_pack_manifests` BEGIN SELECT RAISE(ABORT, 'close pack manifests are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `close_pack_sections_no_update` BEFORE UPDATE ON `close_pack_sections` BEGIN SELECT RAISE(ABORT, 'close pack sections are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `close_pack_sections_no_delete` BEFORE DELETE ON `close_pack_sections` BEGIN SELECT RAISE(ABORT, 'close pack sections are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `close_pack_bodies_no_update` BEFORE UPDATE ON `close_pack_bodies` BEGIN SELECT RAISE(ABORT, 'close pack bodies are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `close_pack_bodies_no_delete` BEFORE DELETE ON `close_pack_bodies` BEGIN SELECT RAISE(ABORT, 'close pack bodies are immutable'); END;
