CREATE TABLE `tenant_pan_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`pan` text NOT NULL,
	`lookup_hash` text NOT NULL,
	`last_four` text NOT NULL,
	`masked_display` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_tenant_pan_shape" CHECK(length("tenant_pan_profiles"."pan") = 10 AND "tenant_pan_profiles"."pan" GLOB '[A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z]'),
	CONSTRAINT "chk_tenant_pan_lookup_hash" CHECK(length("tenant_pan_profiles"."lookup_hash") = 64 AND "tenant_pan_profiles"."lookup_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_tenant_pan_last_four" CHECK("tenant_pan_profiles"."last_four" GLOB '[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]'),
	CONSTRAINT "chk_tenant_pan_masked_display" CHECK("tenant_pan_profiles"."masked_display" = '******' || "tenant_pan_profiles"."last_four")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_pan_profiles_tenant` ON `tenant_pan_profiles` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_pan_profiles_lookup_hash` ON `tenant_pan_profiles` (`lookup_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tenant_pan_profiles_scope_key` ON `tenant_pan_profiles` (`id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `idx_tenant_pan_profiles_tenant` ON `tenant_pan_profiles` (`tenant_id`);
