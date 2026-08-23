import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { bookSets, gstRegistrations, tenants } from "./foundation-schema";
import { gstReturnSnapshots } from "./gst-return-readiness-schema";

/** Immutable GSTR-1 schema packs, canonical artifacts, local validations, and export activities. */
export const gstReturnSchemaPacks = sqliteTable("gst_return_schema_packs", {
  id: text("id").primaryKey(), jurisdiction: text("jurisdiction").notNull(), returnType: text("return_type").notNull(), applicableFrom: text("applicable_from").notNull(), applicableTo: text("applicable_to"), readinessContractVersion: text("readiness_contract_version").notNull(), ruleSnapshotReference: text("rule_snapshot_reference"), artifactReferencesJson: text("artifact_references_json").notNull(), packVersion: text("pack_version").notNull(), validationSchemaJson: text("validation_schema_json").notNull(), mappingSpecJson: text("mapping_spec_json").notNull(), canonicalHash: text("canonical_hash").notNull(), supersedesPackId: text("supersedes_pack_id"), createdAt: text("created_at").notNull(), createdByActorKind: text("created_by_actor_kind").notNull(), createdByActorId: text("created_by_actor_id").notNull(),
}, (table) => ({
  fkSupersedes: foreignKey({ columns: [table.supersedesPackId], foreignColumns: [table.id] }).onDelete("no action"),
  uqHash: uniqueIndex("uq_gst_return_schema_packs_hash").on(table.canonicalHash),
  uqIdentity: uniqueIndex("uq_gst_return_schema_packs_identity").on(table.jurisdiction, table.returnType, table.applicableFrom, table.packVersion),
  idxApplicable: index("idx_gst_return_schema_packs_applicable").on(table.jurisdiction, table.returnType, table.applicableFrom, table.applicableTo),
  chkIdentity: check("chk_gst_return_schema_packs_identity", sql`${table.jurisdiction} = 'IN' AND ${table.returnType} = 'GSTR1'`),
  chkHashes: check("chk_gst_return_schema_packs_hashes", sql`length(${table.canonicalHash}) = 64 AND ${table.canonicalHash} NOT GLOB '*[^0-9a-f]*'`),
  chkActor: check("chk_gst_return_schema_packs_actor", sql`${table.createdByActorKind} IN ('AGENT', 'HUMAN') AND length(trim(${table.createdByActorId})) > 0`),
}));

export const gstReturnSchemaPackEvents = sqliteTable("gst_return_schema_pack_events", {
  id: text("id").primaryKey(), packId: text("pack_id").notNull(), eventType: text("event_type").notNull(), actorKind: text("actor_kind").notNull(), actorId: text("actor_id").notNull(), reason: text("reason").notNull(), expectedPackHash: text("expected_pack_hash").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(), createdAt: text("created_at").notNull(),
}, (table) => ({
  fkPack: foreignKey({ columns: [table.packId], foreignColumns: [gstReturnSchemaPacks.id] }).onDelete("no action"),
  uqRequest: uniqueIndex("uq_gst_return_schema_pack_events_request").on(table.requestId),
  idxPack: index("idx_gst_return_schema_pack_events_pack").on(table.packId, table.createdAt, table.id),
  chkType: check("chk_gst_return_schema_pack_event_type", sql`${table.eventType} IN ('REGISTERED', 'HUMAN_VERIFIED', 'REJECTED', 'SUPERSEDED')`),
  chkActor: check("chk_gst_return_schema_pack_event_actor", sql`${table.actorKind} IN ('AGENT', 'HUMAN') AND length(trim(${table.actorId})) > 0 AND (${table.eventType} IN ('REGISTERED', 'SUPERSEDED') OR ${table.actorKind} = 'HUMAN')`),
  chkHashes: check("chk_gst_return_schema_pack_event_hashes", sql`length(${table.expectedPackHash}) = 64 AND ${table.expectedPackHash} NOT GLOB '*[^0-9a-f]*' AND length(${table.requestHash}) = 64 AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*'`),
}));

export const gstGstr1Artifacts = sqliteTable("gst_gstr1_artifacts", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), registrationId: text("registration_id").notNull(), gstin: text("gstin").notNull(), taxPeriodFrom: text("tax_period_from").notNull(), taxPeriodTo: text("tax_period_to").notNull(), readinessSnapshotId: text("readiness_snapshot_id").notNull(), readinessSnapshotHash: text("readiness_snapshot_hash").notNull(), schemaPackId: text("schema_pack_id").notNull(), schemaPackHash: text("schema_pack_hash").notNull(), contentJson: text("content_json").notNull(), contentByteLength: integer("content_byte_length").notNull(), contentHash: text("content_hash").notNull(), bindingsJson: text("bindings_json").notNull(), createdAt: text("created_at").notNull(), createdByActorKind: text("created_by_actor_kind").notNull(), createdByActorId: text("created_by_actor_id").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(),
}, (table) => ({
  fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
  fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
  fkRegistration: foreignKey({ columns: [table.registrationId, table.tenantId], foreignColumns: [gstRegistrations.id, gstRegistrations.tenantId] }).onDelete("no action"),
  fkSnapshot: foreignKey({ columns: [table.readinessSnapshotId, table.tenantId, table.bookSetId], foreignColumns: [gstReturnSnapshots.id, gstReturnSnapshots.tenantId, gstReturnSnapshots.bookSetId] }).onDelete("no action"),
  fkPack: foreignKey({ columns: [table.schemaPackId], foreignColumns: [gstReturnSchemaPacks.id] }).onDelete("no action"),
  uqScopeId: uniqueIndex("uq_gst_gstr1_artifacts_id_scope").on(table.id, table.tenantId, table.bookSetId),
  uqScopeHash: uniqueIndex("uq_gst_gstr1_artifacts_scope_hash").on(table.tenantId, table.bookSetId, table.registrationId, table.taxPeriodFrom, table.taxPeriodTo, table.contentHash),
  uqRequest: uniqueIndex("uq_gst_gstr1_artifacts_request").on(table.tenantId, table.requestId),
  idxScopePeriod: index("idx_gst_gstr1_artifacts_scope_period").on(table.tenantId, table.bookSetId, table.registrationId, table.taxPeriodFrom, table.taxPeriodTo),
  chkHashes: check("chk_gst_gstr1_artifacts_hashes", sql`length(${table.readinessSnapshotHash}) = 64 AND length(${table.schemaPackHash}) = 64 AND length(${table.contentHash}) = 64 AND length(${table.requestHash}) = 64 AND ${table.readinessSnapshotHash} NOT GLOB '*[^0-9a-f]*' AND ${table.schemaPackHash} NOT GLOB '*[^0-9a-f]*' AND ${table.contentHash} NOT GLOB '*[^0-9a-f]*' AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*'`),
  chkActor: check("chk_gst_gstr1_artifacts_actor", sql`${table.createdByActorKind} IN ('AGENT', 'HUMAN') AND length(trim(${table.createdByActorId})) > 0`),
}));

export const gstGstr1ValidationRuns = sqliteTable("gst_gstr1_validation_runs", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), artifactId: text("artifact_id").notNull(), artifactHash: text("artifact_hash").notNull(), schemaPackHash: text("schema_pack_hash").notNull(), validationHash: text("validation_hash").notNull(), status: text("status").notNull(), diagnosticsJson: text("diagnostics_json").notNull(), createdAt: text("created_at").notNull(), createdByActorKind: text("created_by_actor_kind").notNull(), createdByActorId: text("created_by_actor_id").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(),
}, (table) => ({
  fkArtifact: foreignKey({ columns: [table.artifactId, table.tenantId, table.bookSetId], foreignColumns: [gstGstr1Artifacts.id, gstGstr1Artifacts.tenantId, gstGstr1Artifacts.bookSetId] }).onDelete("no action"),
  uqRequest: uniqueIndex("uq_gst_gstr1_validation_runs_request").on(table.tenantId, table.requestId),
  idxArtifact: index("idx_gst_gstr1_validation_runs_artifact").on(table.tenantId, table.bookSetId, table.artifactId, table.createdAt),
  chkStatus: check("chk_gst_gstr1_validation_runs_status", sql`${table.status} IN ('LOCAL_VALID', 'LOCAL_INVALID')`),
  chkHashes: check("chk_gst_gstr1_validation_runs_hashes", sql`length(${table.artifactHash}) = 64 AND length(${table.schemaPackHash}) = 64 AND length(${table.validationHash}) = 64 AND length(${table.requestHash}) = 64 AND ${table.artifactHash} NOT GLOB '*[^0-9a-f]*' AND ${table.schemaPackHash} NOT GLOB '*[^0-9a-f]*' AND ${table.validationHash} NOT GLOB '*[^0-9a-f]*' AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*'`),
}));

export const gstGstr1ExportActivities = sqliteTable("gst_gstr1_export_activities", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), artifactId: text("artifact_id").notNull(), artifactHash: text("artifact_hash").notNull(), validationHash: text("validation_hash").notNull(), actorKind: text("actor_kind").notNull(), actorId: text("actor_id").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(), createdAt: text("created_at").notNull(),
}, (table) => ({
  fkArtifact: foreignKey({ columns: [table.artifactId, table.tenantId, table.bookSetId], foreignColumns: [gstGstr1Artifacts.id, gstGstr1Artifacts.tenantId, gstGstr1Artifacts.bookSetId] }).onDelete("no action"),
  uqRequest: uniqueIndex("uq_gst_gstr1_export_activities_request").on(table.tenantId, table.requestId),
  idxArtifact: index("idx_gst_gstr1_export_activities_artifact").on(table.tenantId, table.bookSetId, table.artifactId, table.createdAt),
  chkActor: check("chk_gst_gstr1_export_activities_actor", sql`${table.actorKind} = 'HUMAN' AND length(trim(${table.actorId})) > 0`),
  chkHashes: check("chk_gst_gstr1_export_activities_hashes", sql`length(${table.artifactHash}) = 64 AND length(${table.validationHash}) = 64 AND length(${table.requestHash}) = 64 AND ${table.artifactHash} NOT GLOB '*[^0-9a-f]*' AND ${table.validationHash} NOT GLOB '*[^0-9a-f]*' AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*'`),
}));
