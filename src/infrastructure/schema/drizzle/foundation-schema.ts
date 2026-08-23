import { sqliteTable, text, integer, foreignKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/**
 * Foundation schema: Core tables for tenant isolation, accounting entities, and audit.
 * These tables are required for all accounting operations and form the v8 baseline.
 *
 * Note: Complex CHECK constraints and BEFORE triggers are defined in the baseline migration SQL,
 * not in Drizzle schema. This keeps the TypeScript schema readable while preserving all constraints.
 */

export const tenants = sqliteTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    lifecycle: text("lifecycle").notNull(),
    name: text("name").notNull(),
    baseCurrency: text("base_currency").notNull().default("INR"),
    defaultBookSetId: text("default_book_set_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  }
);

export const bookSets = sqliteTable(
  "book_sets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    kind: text("kind").notNull(),
    lifecycle: text("lifecycle").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    uqTenantKind: uniqueIndex("uq_book_set_tenant_kind").on(table.tenantId, table.kind),
    idxTenant: index("idx_book_sets_tenant").on(table.tenantId),
  })
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    bookSetId: text("book_set_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    accountType: text("account_type").notNull(),
    parentAccountId: text("parent_account_id"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    fkBookSet: foreignKey({ columns: [table.bookSetId], foreignColumns: [bookSets.id] }).onDelete("no action"),
    fkParent: foreignKey({
      columns: [table.parentAccountId],
      foreignColumns: [table.id],
    }).onDelete("no action"),
    uqCodeScope: uniqueIndex("uq_account_code_scope").on(table.tenantId, table.bookSetId, table.code),
    idxTenantBookSet: index("idx_accounts_tenant_book_set").on(table.tenantId, table.bookSetId),
  })
);

export const legalIdentities = sqliteTable(
  "legal_identities",
  {
    id: text("id").primaryKey(),
    identityType: text("identity_type").notNull(),
    fingerprint: text("fingerprint").notNull().unique(),
    fingerprintKeyId: text("fingerprint_key_id"),
    lastFour: text("last_four"),
    redactedDisplay: text("redacted_display"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  }
);

export const tenantCreationRequests = sqliteTable(
  "tenant_creation_requests",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull().unique(),
    requestHash: text("request_hash").notNull(),
    tenantId: text("tenant_id"),
    resultJson: text("result_json"),
    resultHash: text("result_hash"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
  })
);

export const gstRegistrations = sqliteTable(
  "gst_registrations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    gstin: text("gstin").notNull(),
    state: text("state"),
    scheme: text("scheme"),
    status: text("status").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    fingerprint: text("fingerprint"),
    fingerprintKeyId: text("fingerprint_key_id"),
    lastFour: text("last_four"),
    redactedDisplay: text("redacted_display"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    idxTenant: index("idx_gst_registrations_tenant").on(table.tenantId),
  })
);

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    contentHash: text("content_hash").notNull().unique(),
    storageReference: text("storage_reference"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    idxTenant: index("idx_evidence_tenant").on(table.tenantId),
  })
);

export const auditRecords = sqliteTable(
  "audit_records",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    action: text("action").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    requestId: text("request_id"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    changeSummary: text("change_summary"),
    evidenceIds: text("evidence_ids"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    idxTenant: index("idx_audit_records_tenant").on(table.tenantId),
    idxRequestId: index("idx_audit_records_request_id").on(table.requestId),
  })
);

export const idempotencyRecords = sqliteTable(
  "idempotency_records",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    resultJson: text("result_json").notNull(),
    resultHash: text("result_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    uqKey: uniqueIndex("uq_idempotency_key").on(table.tenantId, table.requestId),
  })
);

export const databaseControl = sqliteTable(
  "database_control",
  {
    id: integer("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    dataFormatVersion: integer("data_format_version").notNull(),
    readerCompatibilityMin: integer("reader_compatibility_min").notNull(),
    readerCompatibilityMax: integer("reader_compatibility_max").notNull(),
    requiredWriterProtocol: integer("required_writer_protocol").notNull(),
    state: text("state").notNull(),
    revision: integer("revision").notNull(),
    generation: integer("generation").notNull(),
    lastMigrationId: text("last_migration_id").notNull(),
    lastMigrationChecksum: text("last_migration_checksum").notNull(),
    lastWriterCliVersion: text("last_writer_cli_version").notNull(),
    lastWriterBuildId: text("last_writer_build_id").notNull(),
    lastWriterAt: text("last_writer_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    recoveryReason: text("recovery_reason"),
  }
);
