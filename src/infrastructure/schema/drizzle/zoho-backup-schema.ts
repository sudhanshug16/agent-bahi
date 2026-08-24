import { sqliteTable, text, integer, uniqueIndex, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const zohoBackupImports = sqliteTable("zoho_backup_imports", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(),
  bookSetId: text("book_set_id").notNull(), sourceId: text("source_id").notNull(), sourcePath: text("source_path").notNull(),
  archiveHash: text("archive_hash").notNull(), sourceKind: text("source_kind").notNull(), periodStart: text("period_start"), periodEnd: text("period_end"), entityFingerprint: text("entity_fingerprint"),
  status: text("status").notNull(), reportHash: text("report_hash").notNull(), reportJson: text("report_json").notNull(), requestId: text("request_id").notNull(), requestHash: text("request_hash").notNull(), confirmedBy: text("confirmed_by"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => ({ archive: uniqueIndex("uq_zoho_backup_import_source").on(table.tenantId, table.bookSetId, table.archiveHash), request: uniqueIndex("uq_zoho_backup_import_request").on(table.tenantId, table.requestId), statusCheck: check("chk_zoho_backup_import_status", sql`${table.status} in ('PREVIEWED','STAGED','PARTIAL','REJECTED')`) }));

export const zohoBackupImportFiles = sqliteTable("zoho_backup_import_files", {
  id: text("id").primaryKey(), importId: text("import_id").notNull().references(() => zohoBackupImports.id), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), path: text("path").notNull(), contentHash: text("content_hash").notNull(), schemaFingerprint: text("schema_fingerprint").notNull(), headerFingerprint: text("header_fingerprint").notNull(), headersJson: text("headers_json").notNull(), rowCount: integer("row_count").notNull(), objectType: text("object_type").notNull(), status: text("status").notNull(),
}, (table) => ({ path: uniqueIndex("uq_zoho_backup_import_file_path").on(table.importId, table.path), rows: index("idx_zoho_backup_import_files_scope").on(table.tenantId, table.bookSetId) }));

export const zohoBackupImportRows = sqliteTable("zoho_backup_import_rows", {
  id: text("id").primaryKey(), importId: text("import_id").notNull().references(() => zohoBackupImports.id), tenantId: text("tenant_id").notNull(), bookSetId: text("book_set_id").notNull(), filePath: text("file_path").notNull(), rowNumber: integer("row_number").notNull(), objectType: text("object_type").notNull(), externalId: text("external_id"), outcome: text("outcome").notNull(), reason: text("reason").notNull(), sourceRowJson: text("source_row_json").notNull(), sourceRowHash: text("source_row_hash").notNull(), canonicalId: text("canonical_id"),
}, (table) => ({ rows: index("idx_zoho_backup_import_rows").on(table.importId, table.filePath, table.rowNumber) }));
