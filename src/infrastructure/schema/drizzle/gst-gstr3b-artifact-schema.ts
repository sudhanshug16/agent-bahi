import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { bookSets, gstRegistrations, tenants } from "./foundation-schema";

/** Immutable, human-gated GSTR-3B workpapers and supplemental reconciliation facts. */
export const gstGstr3bSchemaPacks = sqliteTable("gst_gstr3b_schema_packs", {
  id: text("id").primaryKey(), jurisdiction: text("jurisdiction").notNull(), returnType: text("return_type").notNull(), filingFrequency: text("filing_frequency").notNull(), applicableFrom: text("applicable_from").notNull(), applicableTo: text("applicable_to"), readinessContractVersion: text("readiness_contract_version").notNull(), ruleSnapshotReference: text("rule_snapshot_reference").notNull(), artifactReferencesJson: text("artifact_references_json").notNull(), packVersion: text("pack_version").notNull(), laneSpecJson: text("lane_spec_json").notNull(), validationSchemaJson: text("validation_schema_json").notNull(), mappingSpecJson: text("mapping_spec_json").notNull(), canonicalHash: text("canonical_hash").notNull(), supersedesPackId: text("supersedes_pack_id"), createdAt: text("created_at").notNull(), createdByActorKind: text("created_by_actor_kind").notNull(), createdByActorId: text("created_by_actor_id").notNull(),
}, (t) => ({
  fkSupersedes: foreignKey({ columns: [t.supersedesPackId], foreignColumns: [t.id] }).onDelete("no action"),
  uqHash: uniqueIndex("uq_gst_gstr3b_schema_packs_hash").on(t.canonicalHash),
  uqIdentity: uniqueIndex("uq_gst_gstr3b_schema_packs_identity").on(t.jurisdiction, t.returnType, t.filingFrequency, t.applicableFrom, t.packVersion),
  idxApplicable: index("idx_gst_gstr3b_schema_packs_applicable").on(t.jurisdiction, t.returnType, t.filingFrequency, t.applicableFrom, t.applicableTo),
  chkIdentity: check("chk_gst_gstr3b_schema_packs_identity", sql`${t.jurisdiction} = 'IN' AND ${t.returnType} = 'GSTR3B' AND ${t.filingFrequency} IN ('MONTHLY','QUARTERLY')`),
  chkHashes: check("chk_gst_gstr3b_schema_packs_hashes", sql`length(${t.canonicalHash}) = 64 AND ${t.canonicalHash} NOT GLOB '*[^0-9a-f]*'`),
  chkActor: check("chk_gst_gstr3b_schema_packs_actor", sql`${t.createdByActorKind} IN ('AGENT','HUMAN') AND length(trim(${t.createdByActorId})) > 0`),
}));

export const gstGstr3bSchemaPackEvents = sqliteTable("gst_gstr3b_schema_pack_events", {
  id: text("id").primaryKey(), packId: text("pack_id").notNull(), eventType: text("event_type").notNull(), actorKind: text("actor_kind").notNull(), actorId: text("actor_id").notNull(), reason: text("reason").notNull(), expectedPackHash: text("expected_pack_hash").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(), createdAt: text("created_at").notNull(),
}, (t) => ({
  fkPack: foreignKey({ columns: [t.packId], foreignColumns: [gstGstr3bSchemaPacks.id] }).onDelete("no action"),
  uqRequest: uniqueIndex("uq_gst_gstr3b_schema_pack_events_request").on(t.requestId),
  idxPack: index("idx_gst_gstr3b_schema_pack_events_pack").on(t.packId, t.createdAt, t.id),
  chkType: check("chk_gst_gstr3b_schema_pack_event_type", sql`${t.eventType} IN ('REGISTERED','HUMAN_VERIFIED','REJECTED','SUPERSEDED')`),
  chkActor: check("chk_gst_gstr3b_schema_pack_event_actor", sql`${t.actorKind} IN ('AGENT','HUMAN') AND length(trim(${t.actorId})) > 0 AND (${t.eventType} IN ('REGISTERED','SUPERSEDED') OR ${t.actorKind} = 'HUMAN')`),
  chkHashes: check("chk_gst_gstr3b_schema_pack_event_hashes", sql`length(${t.expectedPackHash}) = 64 AND ${t.expectedPackHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.requestHash}) = 64 AND ${t.requestHash} NOT GLOB '*[^0-9a-f]*'`),
}));

export const gstGstr3bFacts = sqliteTable("gst_gstr3b_facts", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), gstin: text("gstin").notNull(), taxPeriodFrom: text("tax_period_from").notNull(), taxPeriodTo: text("tax_period_to").notNull(), factType: text("fact_type").notNull(), factsJson: text("facts_json").notNull(), provenanceJson: text("provenance_json").notNull(), canonicalHash: text("canonical_hash").notNull(), createdAt: text("created_at").notNull(), createdByActorKind: text("created_by_actor_kind").notNull(), createdByActorId: text("created_by_actor_id").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(),
}, (t) => ({
  fkTenant: foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
  fkBookSet: foreignKey({ columns: [t.bookSetId, t.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
  uqScopeHash: uniqueIndex("uq_gst_gstr3b_facts_scope_hash").on(t.tenantId, t.bookSetId, t.gstin, t.taxPeriodFrom, t.taxPeriodTo, t.canonicalHash),
  uqRequest: uniqueIndex("uq_gst_gstr3b_facts_request").on(t.tenantId, t.requestId),
  uqScopeId: uniqueIndex("uq_gst_gstr3b_facts_id_scope").on(t.id, t.tenantId, t.bookSetId),
  idxScope: index("idx_gst_gstr3b_facts_scope_period").on(t.tenantId, t.bookSetId, t.gstin, t.taxPeriodFrom, t.taxPeriodTo, t.factType),
  chkType: check("chk_gst_gstr3b_facts_type", sql`${t.factType} IN ('PORTAL_GSTR1_LIABILITY','PORTAL_GSTR2B_ITC','REVERSE_CHARGE_INWARD','IMPORT_GOODS_ITC','IMPORT_SERVICES_ITC','INELIGIBLE_ITC','ITC_REVERSAL','ITC_RECLAIM','INTEREST_LATE_FEE','CASH_LEDGER','CREDIT_LEDGER','TAX_DEPOSIT','NIL_EXEMPT_NONGST','INTERSTATE_UNREGISTERED_SUMMARY','ECOMMERCE_9_5')`),
  chkPeriod: check("chk_gst_gstr3b_facts_period", sql`length(${t.taxPeriodFrom}) = 10 AND length(${t.taxPeriodTo}) = 10 AND ${t.taxPeriodFrom} <= ${t.taxPeriodTo}`),
  chkGstin: check("chk_gst_gstr3b_facts_gstin", sql`length(${t.gstin}) = 15`),
  chkHashes: check("chk_gst_gstr3b_facts_hashes", sql`length(${t.canonicalHash}) = 64 AND ${t.canonicalHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.requestHash}) = 64 AND ${t.requestHash} NOT GLOB '*[^0-9a-f]*'`),
  chkActor: check("chk_gst_gstr3b_facts_actor", sql`${t.createdByActorKind} IN ('AGENT','HUMAN') AND length(trim(${t.createdByActorId})) > 0`),
}));

export const gstGstr3bFactEvents = sqliteTable("gst_gstr3b_fact_events", {
  id: text("id").primaryKey(), factId: text("fact_id").notNull(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), eventType: text("event_type").notNull(), actorKind: text("actor_kind").notNull(), actorId: text("actor_id").notNull(), reason: text("reason").notNull(), expectedFactHash: text("expected_fact_hash").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(), createdAt: text("created_at").notNull(),
}, (t) => ({
  fkFact: foreignKey({ columns: [t.factId, t.tenantId, t.bookSetId], foreignColumns: [gstGstr3bFacts.id, gstGstr3bFacts.tenantId, gstGstr3bFacts.bookSetId] }).onDelete("no action"),
  uqRequest: uniqueIndex("uq_gst_gstr3b_fact_events_request").on(t.tenantId, t.requestId),
  idxFact: index("idx_gst_gstr3b_fact_events_fact").on(t.tenantId, t.bookSetId, t.factId, t.createdAt),
  chkType: check("chk_gst_gstr3b_fact_event_type", sql`${t.eventType} IN ('PROPOSED','HUMAN_CONFIRMED','HUMAN_REJECTED')`),
  chkActor: check("chk_gst_gstr3b_fact_event_actor", sql`${t.actorKind} IN ('AGENT','HUMAN') AND length(trim(${t.actorId})) > 0 AND (${t.eventType} = 'PROPOSED' OR ${t.actorKind} = 'HUMAN')`),
  chkHashes: check("chk_gst_gstr3b_fact_event_hashes", sql`length(${t.expectedFactHash}) = 64 AND ${t.expectedFactHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.requestHash}) = 64 AND ${t.requestHash} NOT GLOB '*[^0-9a-f]*'`),
}));

export const gstGstr3bArtifacts = sqliteTable("gst_gstr3b_artifacts", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), registrationId: text("registration_id").notNull(), gstin: text("gstin").notNull(), filingFrequency: text("filing_frequency").notNull(), taxPeriodFrom: text("tax_period_from").notNull(), taxPeriodTo: text("tax_period_to").notNull(), schemaPackId: text("schema_pack_id").notNull(), schemaPackHash: text("schema_pack_hash").notNull(), sourceModelHash: text("source_model_hash").notNull(), gstr1ArtifactId: text("gstr1_artifact_id"), gstr1ArtifactHash: text("gstr1_artifact_hash"), contentJson: text("content_json").notNull(), contentByteLength: integer("content_byte_length").notNull(), contentHash: text("content_hash").notNull(), bindingsJson: text("bindings_json").notNull(), createdAt: text("created_at").notNull(), createdByActorKind: text("created_by_actor_kind").notNull(), createdByActorId: text("created_by_actor_id").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(),
}, (t) => ({
  fkTenant: foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"), fkBookSet: foreignKey({ columns: [t.bookSetId, t.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"), fkRegistration: foreignKey({ columns: [t.registrationId, t.tenantId], foreignColumns: [gstRegistrations.id, gstRegistrations.tenantId] }).onDelete("no action"), fkPack: foreignKey({ columns: [t.schemaPackId], foreignColumns: [gstGstr3bSchemaPacks.id] }).onDelete("no action"),
  uqScopeHash: uniqueIndex("uq_gst_gstr3b_artifacts_scope_hash").on(t.tenantId, t.bookSetId, t.gstin, t.taxPeriodFrom, t.taxPeriodTo, t.contentHash), uqRequest: uniqueIndex("uq_gst_gstr3b_artifacts_request").on(t.tenantId, t.requestId), uqScopeId: uniqueIndex("uq_gst_gstr3b_artifacts_id_scope").on(t.id, t.tenantId, t.bookSetId), idxScope: index("idx_gst_gstr3b_artifacts_scope_period").on(t.tenantId, t.bookSetId, t.gstin, t.taxPeriodFrom, t.taxPeriodTo, t.createdAt),
  chkIdentity: check("chk_gst_gstr3b_artifacts_identity", sql`${t.filingFrequency} IN ('MONTHLY','QUARTERLY') AND length(${t.gstin}) = 15`), chkHashes: check("chk_gst_gstr3b_artifacts_hashes", sql`length(${t.schemaPackHash}) = 64 AND ${t.schemaPackHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.sourceModelHash}) = 64 AND ${t.sourceModelHash} NOT GLOB '*[^0-9a-f]*' AND (${t.gstr1ArtifactHash} IS NULL OR (length(${t.gstr1ArtifactHash}) = 64 AND ${t.gstr1ArtifactHash} NOT GLOB '*[^0-9a-f]*')) AND length(${t.contentHash}) = 64 AND ${t.contentHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.requestHash}) = 64 AND ${t.requestHash} NOT GLOB '*[^0-9a-f]*'`), chkActor: check("chk_gst_gstr3b_artifacts_actor", sql`${t.createdByActorKind} IN ('AGENT','HUMAN') AND length(trim(${t.createdByActorId})) > 0`),
}));

export const gstGstr3bValidationRuns = sqliteTable("gst_gstr3b_validation_runs", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), artifactId: text("artifact_id").notNull(), artifactHash: text("artifact_hash").notNull(), schemaPackHash: text("schema_pack_hash").notNull(), validationHash: text("validation_hash").notNull(), status: text("status").notNull(), diagnosticsJson: text("diagnostics_json").notNull(), createdAt: text("created_at").notNull(), createdByActorKind: text("created_by_actor_kind").notNull(), createdByActorId: text("created_by_actor_id").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(),
}, (t) => ({ fkArtifact: foreignKey({ columns: [t.artifactId, t.tenantId, t.bookSetId], foreignColumns: [gstGstr3bArtifacts.id, gstGstr3bArtifacts.tenantId, gstGstr3bArtifacts.bookSetId] }).onDelete("no action"), uqRequest: uniqueIndex("uq_gst_gstr3b_validation_runs_request").on(t.tenantId, t.requestId), idxArtifact: index("idx_gst_gstr3b_validation_runs_artifact").on(t.tenantId, t.bookSetId, t.artifactId, t.createdAt), chkStatus: check("chk_gst_gstr3b_validation_runs_status", sql`${t.status} IN ('LOCAL_VALID','LOCAL_INVALID')`), chkHashes: check("chk_gst_gstr3b_validation_runs_hashes", sql`length(${t.artifactHash}) = 64 AND ${t.artifactHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.schemaPackHash}) = 64 AND ${t.schemaPackHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.validationHash}) = 64 AND ${t.validationHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.requestHash}) = 64 AND ${t.requestHash} NOT GLOB '*[^0-9a-f]*'`) }));

export const gstGstr3bExportActivities = sqliteTable("gst_gstr3b_export_activities", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), artifactId: text("artifact_id").notNull(), artifactHash: text("artifact_hash").notNull(), validationHash: text("validation_hash").notNull(), actorKind: text("actor_kind").notNull(), actorId: text("actor_id").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(), createdAt: text("created_at").notNull(),
}, (t) => ({ fkArtifact: foreignKey({ columns: [t.artifactId, t.tenantId, t.bookSetId], foreignColumns: [gstGstr3bArtifacts.id, gstGstr3bArtifacts.tenantId, gstGstr3bArtifacts.bookSetId] }).onDelete("no action"), uqRequest: uniqueIndex("uq_gst_gstr3b_export_activities_request").on(t.tenantId, t.requestId), idxArtifact: index("idx_gst_gstr3b_export_activities_artifact").on(t.tenantId, t.bookSetId, t.artifactId, t.createdAt), chkActor: check("chk_gst_gstr3b_export_activities_actor", sql`${t.actorKind} = 'HUMAN' AND length(trim(${t.actorId})) > 0`), chkHashes: check("chk_gst_gstr3b_export_activities_hashes", sql`length(${t.artifactHash}) = 64 AND ${t.artifactHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.validationHash}) = 64 AND ${t.validationHash} NOT GLOB '*[^0-9a-f]*' AND length(${t.requestHash}) = 64 AND ${t.requestHash} NOT GLOB '*[^0-9a-f]*'`) }));
