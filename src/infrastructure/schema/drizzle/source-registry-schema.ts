import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { tenants, bookSets } from "./foundation-schema";

/** Immutable, tenant + BookSet scoped source provenance for local imports. */
export const sourceRegistrations = sqliteTable(
  "source_registrations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceLocator: text("source_locator").notNull(),
    mediaType: text("media_type").notNull(),
    encoding: text("encoding").notNull(),
    parserId: text("parser_id").notNull(),
    parserVersion: text("parser_version").notNull(),
    schemaFingerprint: text("schema_fingerprint").notNull(),
    headerFingerprint: text("header_fingerprint").notNull(),
    rowCount: integer("row_count").notNull(),
    sourcePeriodStart: text("source_period_start").notNull(),
    sourcePeriodEnd: text("source_period_end").notNull(),
    maskedEntityIdentity: text("masked_entity_identity").notNull(),
    maskedAccountIdentity: text("masked_account_identity").notNull(),
    authorityState: text("authority_state").notNull(),
    createdAt: text("created_at").notNull(),
    createdByActorKind: text("created_by_actor_kind").notNull(),
    createdByActorId: text("created_by_actor_id").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    uqScopeContentParser: uniqueIndex("uq_source_registrations_scope_content_parser").on(table.tenantId, table.bookSetId, table.contentHash, table.parserId, table.parserVersion),
    uqScopeId: uniqueIndex("uq_source_registrations_scope_id").on(table.id, table.tenantId, table.bookSetId),
    idxScope: index("idx_source_registrations_scope_created").on(table.tenantId, table.bookSetId, table.createdAt, table.id),
    chkHash: check("chk_source_registrations_content_hash", sql`length(${table.contentHash}) = 64 AND ${table.contentHash} NOT GLOB '*[^0-9a-f]*'`),
    chkFingerprint: check("chk_source_registrations_fingerprints", sql`length(${table.schemaFingerprint}) = 64 AND ${table.schemaFingerprint} NOT GLOB '*[^0-9a-f]*' AND length(${table.headerFingerprint}) = 64 AND ${table.headerFingerprint} NOT GLOB '*[^0-9a-f]*'`),
    chkRows: check("chk_source_registrations_row_count", sql`typeof(${table.rowCount}) = 'integer' AND ${table.rowCount} >= 0`),
    chkAuthority: check("chk_source_registrations_authority", sql`${table.authorityState} IN ('PRIMARY', 'DERIVED', 'UNVERIFIED')`),
    chkActor: check("chk_source_registrations_actor", sql`${table.createdByActorKind} IN ('HUMAN', 'AGENT', 'SYSTEM') AND length(trim(${table.createdByActorId})) > 0`),
  }),
);

export const sourceImportEvents = sqliteTable(
  "source_import_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    sourceId: text("source_id").notNull(),
    eventType: text("event_type").notNull(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    reason: text("reason").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    detailsJson: text("details_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkSource: foreignKey({ columns: [table.sourceId, table.tenantId, table.bookSetId], foreignColumns: [sourceRegistrations.id, sourceRegistrations.tenantId, sourceRegistrations.bookSetId] }).onDelete("no action"),
    uqRequest: uniqueIndex("uq_source_import_events_request").on(table.tenantId, table.requestId),
    uqScopeId: uniqueIndex("uq_source_import_events_scope_id").on(table.id, table.tenantId, table.bookSetId),
    idxSource: index("idx_source_import_events_source_created").on(table.tenantId, table.bookSetId, table.sourceId, table.createdAt, table.id),
    chkEvent: check("chk_source_import_events_type", sql`${table.eventType} IN ('PREVIEWED', 'IMPORTED', 'REJECTED')`),
    chkHash: check("chk_source_import_events_hash", sql`length(${table.requestHash}) = 64 AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*'`),
    chkActor: check("chk_source_import_events_actor", sql`${table.actorKind} IN ('HUMAN', 'AGENT', 'SYSTEM') AND length(trim(${table.actorId})) > 0`),
  }),
);
