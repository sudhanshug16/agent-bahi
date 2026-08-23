CREATE TABLE `compliance_applicability_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`fact_profile_id` text NOT NULL,
	`decision` text NOT NULL,
	`missing_keys_json` text NOT NULL,
	`input_hash` text NOT NULL,
	`reasoning_codes_json` text NOT NULL,
	`evaluated_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_rule_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fact_profile_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_fact_profiles`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_compliance_applicability_decision" CHECK("compliance_applicability_decisions"."decision" IN ('APPLIES', 'DOES_NOT_APPLY', 'UNKNOWN')),
	CONSTRAINT "chk_compliance_applicability_hash" CHECK(length("compliance_applicability_decisions"."input_hash") = 64 AND "compliance_applicability_decisions"."input_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_applicability_input` ON `compliance_applicability_decisions` (`rule_id`,`fact_profile_id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_applicability_scope_key` ON `compliance_applicability_decisions` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_compliance_applicability_decision` ON `compliance_applicability_decisions` (`tenant_id`,`book_set_id`,`decision`,`rule_id`);--> statement-breakpoint
CREATE TABLE `compliance_deadline_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`due_date` text NOT NULL,
	`source_url` text NOT NULL,
	`evidence_reference` text NOT NULL,
	`source_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_rule_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_compliance_deadline_period_order" CHECK("compliance_deadline_snapshots"."period_start" <= "compliance_deadline_snapshots"."period_end" AND "compliance_deadline_snapshots"."period_start" <= "compliance_deadline_snapshots"."due_date"),
	CONSTRAINT "chk_compliance_deadline_source" CHECK("compliance_deadline_snapshots"."source_url" GLOB 'https://*' AND length(trim("compliance_deadline_snapshots"."evidence_reference")) > 0),
	CONSTRAINT "chk_compliance_deadline_hash" CHECK(length("compliance_deadline_snapshots"."source_hash") = 64 AND "compliance_deadline_snapshots"."source_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_deadline_rule_period` ON `compliance_deadline_snapshots` (`rule_id`,`tenant_id`,`book_set_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_deadline_scope_key` ON `compliance_deadline_snapshots` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_compliance_deadline_calendar` ON `compliance_deadline_snapshots` (`tenant_id`,`book_set_id`,`due_date`,`period_start`,`rule_id`);--> statement-breakpoint
CREATE TABLE `compliance_fact_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`gst_registration_id` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`facts_json` text NOT NULL,
	`source_url` text NOT NULL,
	`evidence_reference` text NOT NULL,
	`verification_status` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gst_registration_id`,`tenant_id`) REFERENCES `gst_registrations`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_compliance_fact_profile_status" CHECK("compliance_fact_profiles"."verification_status" IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
	CONSTRAINT "chk_compliance_fact_profile_dates" CHECK("compliance_fact_profiles"."effective_to" IS NULL OR "compliance_fact_profiles"."effective_from" <= "compliance_fact_profiles"."effective_to"),
	CONSTRAINT "chk_compliance_fact_profile_source" CHECK("compliance_fact_profiles"."source_url" GLOB 'https://*' AND length(trim("compliance_fact_profiles"."evidence_reference")) > 0),
	CONSTRAINT "chk_compliance_fact_profile_hash" CHECK(length("compliance_fact_profiles"."canonical_hash") = 64 AND "compliance_fact_profiles"."canonical_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_fact_profiles_scope_key` ON `compliance_fact_profiles` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_compliance_fact_profiles_effective` ON `compliance_fact_profiles` (`tenant_id`,`book_set_id`,`gst_registration_id`,`effective_from`,`id`);--> statement-breakpoint
CREATE TABLE `compliance_obligation_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`obligation_id` text NOT NULL,
	`artifact_kind` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`artifact_reference` text NOT NULL,
	`metadata_json` text NOT NULL,
	`attached_at` text NOT NULL,
	`attached_by_actor_id` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`obligation_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_obligations`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_compliance_artifact_hash" CHECK(length("compliance_obligation_artifacts"."artifact_hash") = 64 AND "compliance_obligation_artifacts"."artifact_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_obligation_artifact` ON `compliance_obligation_artifacts` (`obligation_id`,`artifact_kind`,`artifact_hash`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_artifact_scope_key` ON `compliance_obligation_artifacts` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_compliance_artifact_obligation` ON `compliance_obligation_artifacts` (`tenant_id`,`book_set_id`,`obligation_id`);--> statement-breakpoint
CREATE TABLE `compliance_obligation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`obligation_id` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`evidence_reference` text,
	`artifact_id` text,
	`result_hash` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`obligation_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_obligations`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_obligation_artifacts`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_compliance_event_type" CHECK("compliance_obligation_events"."event_type" IN ('OPEN', 'READY', 'EXPORTED', 'USER_MARKED_SUBMITTED', 'ACKNOWLEDGED', 'CLOSED', 'REJECTED', 'WAIVED', 'EXEMPT')),
	CONSTRAINT "chk_compliance_event_hash" CHECK(length("compliance_obligation_events"."result_hash") = 64 AND "compliance_obligation_events"."result_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "chk_compliance_event_evidence" CHECK(("compliance_obligation_events"."event_type" IN ('USER_MARKED_SUBMITTED', 'ACKNOWLEDGED', 'WAIVED', 'EXEMPT') AND length(trim(COALESCE("compliance_obligation_events"."evidence_reference", ''))) > 0) OR "compliance_obligation_events"."event_type" NOT IN ('USER_MARKED_SUBMITTED', 'ACKNOWLEDGED', 'WAIVED', 'EXEMPT'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_event_scope_key` ON `compliance_obligation_events` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_compliance_event_timeline` ON `compliance_obligation_events` (`tenant_id`,`book_set_id`,`obligation_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE TABLE `compliance_obligations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`gst_registration_id` text,
	`rule_id` text NOT NULL,
	`deadline_id` text NOT NULL,
	`fact_profile_id` text NOT NULL,
	`applicability_decision_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`due_date` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gst_registration_id`,`tenant_id`) REFERENCES `gst_registrations`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_rule_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deadline_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_deadline_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fact_profile_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_fact_profiles`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applicability_decision_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_applicability_decisions`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_compliance_obligation_dates" CHECK("compliance_obligations"."period_start" <= "compliance_obligations"."period_end" AND "compliance_obligations"."period_start" <= "compliance_obligations"."due_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_obligation_identity` ON `compliance_obligations` (`tenant_id`,`book_set_id`,`gst_registration_id`,`rule_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_obligation_scope_key` ON `compliance_obligations` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_compliance_obligation_due` ON `compliance_obligations` (`tenant_id`,`book_set_id`,`due_date`,`rule_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_obligation_identity_strict` ON `compliance_obligations` (`tenant_id`,`book_set_id`,COALESCE(`gst_registration_id`, ''),`rule_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `compliance_rule_predecessors` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`predecessor_rule_id` text NOT NULL,
	`required_status` text NOT NULL,
	`source_url` text NOT NULL,
	`evidence_reference` text NOT NULL,
	`source_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_rule_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`predecessor_rule_id`,`tenant_id`,`book_set_id`) REFERENCES `compliance_rule_snapshots`(`id`,`tenant_id`,`book_set_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_compliance_rule_predecessor_status" CHECK("compliance_rule_predecessors"."required_status" IN ('OPEN', 'READY', 'EXPORTED', 'USER_MARKED_SUBMITTED', 'ACKNOWLEDGED', 'CLOSED')),
	CONSTRAINT "chk_compliance_rule_predecessor_source" CHECK("compliance_rule_predecessors"."source_url" GLOB 'https://*' AND length(trim("compliance_rule_predecessors"."evidence_reference")) > 0),
	CONSTRAINT "chk_compliance_rule_predecessor_hash" CHECK(length("compliance_rule_predecessors"."source_hash") = 64 AND "compliance_rule_predecessors"."source_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_rule_predecessor` ON `compliance_rule_predecessors` (`rule_id`,`predecessor_rule_id`,`required_status`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_compliance_rule_predecessor_rule` ON `compliance_rule_predecessors` (`tenant_id`,`book_set_id`,`rule_id`);--> statement-breakpoint
CREATE TABLE `compliance_rule_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`book_set_id` text NOT NULL,
	`code` text NOT NULL,
	`version` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`authority` text NOT NULL,
	`form_label` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`official_source_url` text NOT NULL,
	`law_reference` text NOT NULL,
	`source_version` text NOT NULL,
	`source_hash` text NOT NULL,
	`evidence_reference` text NOT NULL,
	`verification_status` text NOT NULL,
	`required_fact_keys_json` text NOT NULL,
	`applicability_predicate_json` text NOT NULL,
	`canonical_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_set_id`,`tenant_id`) REFERENCES `book_sets`(`id`,`tenant_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_compliance_rule_status" CHECK("compliance_rule_snapshots"."verification_status" IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
	CONSTRAINT "chk_compliance_rule_dates" CHECK("compliance_rule_snapshots"."effective_to" IS NULL OR "compliance_rule_snapshots"."effective_from" <= "compliance_rule_snapshots"."effective_to"),
	CONSTRAINT "chk_compliance_rule_source" CHECK("compliance_rule_snapshots"."official_source_url" GLOB 'https://*' AND length(trim("compliance_rule_snapshots"."law_reference")) > 0 AND length(trim("compliance_rule_snapshots"."source_version")) > 0 AND length(trim("compliance_rule_snapshots"."evidence_reference")) > 0),
	CONSTRAINT "chk_compliance_rule_hash" CHECK(length("compliance_rule_snapshots"."source_hash") = 64 AND length("compliance_rule_snapshots"."canonical_hash") = 64 AND "compliance_rule_snapshots"."source_hash" NOT GLOB '*[^0-9a-f]*' AND "compliance_rule_snapshots"."canonical_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_rule_code_version` ON `compliance_rule_snapshots` (`tenant_id`,`book_set_id`,`code`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_compliance_rule_snapshots_scope_key` ON `compliance_rule_snapshots` (`id`,`tenant_id`,`book_set_id`);--> statement-breakpoint
CREATE INDEX `idx_compliance_rule_snapshots_effective` ON `compliance_rule_snapshots` (`tenant_id`,`book_set_id`,`code`,`effective_from`,`id`);--> statement-breakpoint
CREATE TRIGGER `compliance_fact_profiles_no_update` BEFORE UPDATE ON `compliance_fact_profiles` BEGIN SELECT RAISE(ABORT, 'compliance fact profiles are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_fact_profiles_no_delete` BEFORE DELETE ON `compliance_fact_profiles` BEGIN SELECT RAISE(ABORT, 'compliance fact profiles are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_rule_snapshots_no_update` BEFORE UPDATE ON `compliance_rule_snapshots` BEGIN SELECT RAISE(ABORT, 'compliance rule snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_rule_snapshots_no_delete` BEFORE DELETE ON `compliance_rule_snapshots` BEGIN SELECT RAISE(ABORT, 'compliance rule snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_deadline_snapshots_no_update` BEFORE UPDATE ON `compliance_deadline_snapshots` BEGIN SELECT RAISE(ABORT, 'compliance deadline snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_deadline_snapshots_no_delete` BEFORE DELETE ON `compliance_deadline_snapshots` BEGIN SELECT RAISE(ABORT, 'compliance deadline snapshots are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_applicability_decisions_no_update` BEFORE UPDATE ON `compliance_applicability_decisions` BEGIN SELECT RAISE(ABORT, 'compliance applicability decisions are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_applicability_decisions_no_delete` BEFORE DELETE ON `compliance_applicability_decisions` BEGIN SELECT RAISE(ABORT, 'compliance applicability decisions are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_rule_predecessors_no_update` BEFORE UPDATE ON `compliance_rule_predecessors` BEGIN SELECT RAISE(ABORT, 'compliance rule predecessors are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_rule_predecessors_no_delete` BEFORE DELETE ON `compliance_rule_predecessors` BEGIN SELECT RAISE(ABORT, 'compliance rule predecessors are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_obligations_no_update` BEFORE UPDATE ON `compliance_obligations` BEGIN SELECT RAISE(ABORT, 'compliance obligations are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_obligations_no_delete` BEFORE DELETE ON `compliance_obligations` BEGIN SELECT RAISE(ABORT, 'compliance obligations are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_obligation_artifacts_no_update` BEFORE UPDATE ON `compliance_obligation_artifacts` BEGIN SELECT RAISE(ABORT, 'compliance obligation artifacts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_obligation_artifacts_no_delete` BEFORE DELETE ON `compliance_obligation_artifacts` BEGIN SELECT RAISE(ABORT, 'compliance obligation artifacts are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_obligation_events_no_update` BEFORE UPDATE ON `compliance_obligation_events` BEGIN SELECT RAISE(ABORT, 'compliance obligation events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_obligation_events_no_delete` BEFORE DELETE ON `compliance_obligation_events` BEGIN SELECT RAISE(ABORT, 'compliance obligation events are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `compliance_fact_profiles_no_overlap` BEFORE INSERT ON `compliance_fact_profiles` BEGIN SELECT RAISE(ABORT, 'overlapping compliance fact profiles are ambiguous') WHERE EXISTS (SELECT 1 FROM compliance_fact_profiles p WHERE p.tenant_id = NEW.tenant_id AND p.book_set_id = NEW.book_set_id AND COALESCE(p.gst_registration_id, '') = COALESCE(NEW.gst_registration_id, '') AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31') AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from); END;--> statement-breakpoint
CREATE TRIGGER `compliance_rule_snapshots_no_overlap` BEFORE INSERT ON `compliance_rule_snapshots` BEGIN SELECT RAISE(ABORT, 'overlapping compliance rule snapshots are ambiguous') WHERE EXISTS (SELECT 1 FROM compliance_rule_snapshots p WHERE p.tenant_id = NEW.tenant_id AND p.book_set_id = NEW.book_set_id AND p.code = NEW.code AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31') AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from); END;
