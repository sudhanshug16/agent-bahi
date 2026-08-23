import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { bookSets } from "./foundation-schema";

export const closePackManifests = sqliteTable(
  "close_pack_manifests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    asOfDate: text("as_of_date").notNull(),
    basis: text("basis").notNull(),
    manifestFormat: text("manifest_format").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    periodCloseStateHash: text("period_close_state_hash").notNull(),
    periodCloseLabel: text("period_close_label").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    governmentCompatible: integer("government_compatible").notNull(),
    submitted: integer("submitted").notNull(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    resultJson: text("result_json").notNull(),
    resultHash: text("result_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    uqRequest: uniqueIndex("uq_close_pack_manifest_request").on(table.tenantId, table.bookSetId, table.requestId),
    uqScopeKey: uniqueIndex("uq_close_pack_manifest_scope_key").on(table.id, table.tenantId, table.bookSetId),
    idxScopePeriod: index("idx_close_pack_manifests_scope_period").on(table.tenantId, table.bookSetId, table.periodStart, table.periodEnd, table.createdAt, table.id),
    chkDates: check("chk_close_pack_manifest_dates", sql`length(${table.periodStart}) = 10 AND length(${table.periodEnd}) = 10 AND length(${table.asOfDate}) = 10 AND ${table.periodStart} <= ${table.periodEnd}`),
    chkBasis: check("chk_close_pack_manifest_basis", sql`${table.basis} = 'ACCRUAL'`),
    chkFormat: check("chk_close_pack_manifest_format", sql`${table.manifestFormat} = 'NEUTRAL_CA_CLOSE_PACK_V1'`),
    chkVersion: check("chk_close_pack_manifest_version", sql`${table.schemaVersion} = 1`),
    chkLabel: check("chk_close_pack_manifest_label", sql`${table.periodCloseLabel} IN ('OPEN', 'CLOSED', 'REOPENED')`),
    chkHashes: check("chk_close_pack_manifest_hashes", sql`length(${table.periodCloseStateHash}) = 64 AND ${table.periodCloseStateHash} NOT GLOB '*[^0-9a-f]*' AND length(${table.manifestHash}) = 64 AND ${table.manifestHash} NOT GLOB '*[^0-9a-f]*' AND length(${table.requestHash}) = 64 AND ${table.requestHash} NOT GLOB '*[^0-9a-f]*' AND length(${table.resultHash}) = 64 AND ${table.resultHash} NOT GLOB '*[^0-9a-f]*'`),
    chkBoolean: check("chk_close_pack_manifest_boolean", sql`${table.governmentCompatible} IN (0, 1) AND ${table.submitted} IN (0, 1)`),
  }),
);

export const closePackSections = sqliteTable(
  "close_pack_sections",
  {
    id: text("id").primaryKey(),
    manifestId: text("manifest_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    sectionName: text("section_name").notNull(),
    rowCount: integer("row_count").notNull(),
    bodyHash: text("body_hash").notNull(),
    bodySizeBytes: integer("body_size_bytes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkManifest: foreignKey({ columns: [table.manifestId, table.tenantId, table.bookSetId], foreignColumns: [closePackManifests.id, closePackManifests.tenantId, closePackManifests.bookSetId] }).onDelete("no action"),
    uqName: uniqueIndex("uq_close_pack_section_name").on(table.manifestId, table.sectionName),
    uqScopeKey: uniqueIndex("uq_close_pack_section_scope_key").on(table.id, table.manifestId, table.tenantId, table.bookSetId),
    idxManifest: index("idx_close_pack_sections_manifest").on(table.manifestId, table.createdAt, table.id),
    chkCounts: check("chk_close_pack_section_counts", sql`${table.rowCount} >= 0 AND ${table.bodySizeBytes} >= 0`),
    chkHash: check("chk_close_pack_section_hash", sql`length(${table.bodyHash}) = 64 AND ${table.bodyHash} NOT GLOB '*[^0-9a-f]*'`),
  }),
);

export const closePackBodies = sqliteTable(
  "close_pack_bodies",
  {
    id: text("id").primaryKey(),
    sectionId: text("section_id").notNull(),
    manifestId: text("manifest_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    csvBody: text("csv_body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkSection: foreignKey({ columns: [table.sectionId, table.manifestId, table.tenantId, table.bookSetId], foreignColumns: [closePackSections.id, closePackSections.manifestId, closePackSections.tenantId, closePackSections.bookSetId] }).onDelete("no action"),
    uqSection: uniqueIndex("uq_close_pack_body_section").on(table.sectionId),
    uqScopeKey: uniqueIndex("uq_close_pack_body_scope_key").on(table.id, table.sectionId, table.manifestId, table.tenantId, table.bookSetId),
    chkNonEmpty: check("chk_close_pack_body_nonempty", sql`length(${table.csvBody}) > 0`),
  }),
);
