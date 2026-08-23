import { sqliteTable, text, integer, foreignKey, uniqueIndex, index, check, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Foundation schema: Core tables for tenant isolation, accounting entities, and audit.
 * These tables are required for all accounting operations and form the v8 baseline.
 *
 * BEFORE triggers remain in the migration SQL because Drizzle cannot express
 * their procedural guards. Declarative checks, keys, and indexes stay typed.
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
  },
  (table) => ({
    chkKind: check("chk_tenant_kind", sql`${table.kind} IN ('COMPANY', 'INDIVIDUAL')`),
    chkLifecycle: check("chk_tenant_lifecycle", sql`${table.lifecycle} IN ('CREATING', 'ACTIVE', 'ARCHIVED')`),
    chkName: check("chk_tenant_name", sql`length(trim(${table.name})) > 0`),
  })
);

export const bookSets = sqliteTable(
  "book_sets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    kind: text("kind").notNull(),
    displayName: text("display_name").notNull(),
    lifecycle: text("lifecycle").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    uqTenantCompany: uniqueIndex("uq_book_set_tenant_company").on(table.tenantId, table.kind).where(sql`${table.kind} = 'COMPANY'`),
    uqTenantPersonal: uniqueIndex("uq_book_set_tenant_personal").on(table.tenantId, table.kind).where(sql`${table.kind} = 'PERSONAL'`),
    uqTenantDisplayName: uniqueIndex("uq_book_set_tenant_display_name").on(table.tenantId, sql`${table.displayName} COLLATE NOCASE`),
    uqIdTenant: uniqueIndex("uq_book_sets_id_tenant_v4").on(table.id, table.tenantId),
    idxTenant: index("idx_book_sets_tenant").on(table.tenantId),
    chkKind: check("chk_book_set_kind", sql`${table.kind} IN ('COMPANY', 'PERSONAL', 'PROPRIETORSHIP')`),
    chkLifecycle: check("chk_book_set_lifecycle", sql`${table.lifecycle} IN ('ACTIVE', 'ARCHIVED')`),
    chkDisplayName: check("chk_book_set_display_name", sql`length(${table.displayName}) > 0 AND ${table.displayName} = trim(${table.displayName})`),
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
      // Recursive references need the lazy AnySQLiteColumn form so Drizzle's
      // schema graph does not evaluate the table before it is declared.
      foreignColumns: [table.id as AnySQLiteColumn],
    }).onDelete("no action"),
    uqCodeScope: uniqueIndex("uq_account_code_scope").on(table.tenantId, table.bookSetId, table.code),
    uqIdTenantBookSet: uniqueIndex("uq_accounts_id_tenant_book_set_v5").on(table.id, table.tenantId, table.bookSetId),
    idxTenantBookSet: index("idx_accounts_tenant_book_set").on(table.tenantId, table.bookSetId),
    chkCode: check("chk_account_code", sql`length(trim(${table.code})) > 0`),
    chkName: check("chk_account_name", sql`length(trim(${table.name})) > 0`),
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
  },
  (table) => ({
    chkIdentityType: check("chk_legal_identity_type", sql`${table.identityType} IN ('INDIVIDUAL_PAN', 'COMPANY_CIN')`),
  })
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
    chkStatus: check("chk_gst_registration_status", sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
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
    occurredAt: text("occurred_at"),
    action: text("action").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    requestId: text("request_id"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    correlationId: text("correlation_id"),
    changeSummary: text("change_summary"),
    evidenceIds: text("evidence_ids"),
    createdAt: text("created_at").notNull(),
    legacyEntityType: text("legacy_entity_type"),
    legacyEntityId: text("legacy_entity_id"),
    bookSetId: text("book_set_id"),
    command: text("command"),
    source: text("source"),
    reason: text("reason"),
    canonicalBeforeHash: text("canonical_before_hash"),
    canonicalAfterHash: text("canonical_after_hash"),
    committedAt: text("committed_at"),
    recordVersion: integer("record_version").notNull().default(1),
  },
  (table) => ({
    fkTenant: foreignKey({ columns: [table.tenantId], foreignColumns: [tenants.id] }).onDelete("no action"),
    fkBookSet: foreignKey({ columns: [table.bookSetId, table.tenantId], foreignColumns: [bookSets.id, bookSets.tenantId] }).onDelete("no action"),
    idxTenant: index("idx_audit_records_tenant").on(table.tenantId),
    idxRequestId: index("idx_audit_records_request_id").on(table.requestId),
    idxBookSet: index("idx_audit_records_book_set").on(table.bookSetId),
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
  },
  (table) => ({
    chkIdSingleton: check("chk_id_singleton", sql`${table.id} = 1`),
    chkSchemaVersion: check("chk_schema_version", sql`${table.schemaVersion} >= 1 AND typeof(${table.schemaVersion}) = 'integer'`),
    chkDataFormatVersion: check("chk_data_format_version", sql`${table.dataFormatVersion} >= 1 AND typeof(${table.dataFormatVersion}) = 'integer'`),
    chkReaderMin: check("chk_reader_min", sql`${table.readerCompatibilityMin} >= 1 AND typeof(${table.readerCompatibilityMin}) = 'integer'`),
    chkReaderMax: check("chk_reader_max", sql`${table.readerCompatibilityMax} >= ${table.readerCompatibilityMin} AND typeof(${table.readerCompatibilityMax}) = 'integer'`),
    chkWriterProtocol: check("chk_writer_protocol", sql`${table.requiredWriterProtocol} >= 1 AND typeof(${table.requiredWriterProtocol}) = 'integer'`),
    chkState: check("chk_state", sql`${table.state} IN ('READY', 'APPLYING', 'RECOVERY_REQUIRED')`),
    chkRevision: check("chk_revision", sql`${table.revision} >= 1 AND typeof(${table.revision}) = 'integer'`),
    chkGeneration: check("chk_generation", sql`${table.generation} >= 1 AND typeof(${table.generation}) = 'integer'`),
    chkLastMigrationId: check("chk_last_migration_id", sql`trim(${table.lastMigrationId}) <> ''`),
    chkChecksumLength: check("chk_checksum_length", sql`length(${table.lastMigrationChecksum}) = 64`),
    chkChecksumHex: check("chk_checksum_hex", sql`${table.lastMigrationChecksum} NOT GLOB '*[^0-9a-f]*'`),
    chkCliVersion: check("chk_cli_version", sql`trim(${table.lastWriterCliVersion}) <> ''`),
    chkBuildId: check("chk_build_id", sql`trim(${table.lastWriterBuildId}) <> ''`),
    chkWriterAt: check("chk_writer_at", sql`trim(${table.lastWriterAt}) <> ''`),
    chkCreatedAt: check("chk_created_at", sql`trim(${table.createdAt}) <> ''`),
    chkUpdatedAt: check("chk_updated_at", sql`trim(${table.updatedAt}) <> ''`),
    chkRecoveryReasonState: check("chk_recovery_reason_state", sql`CASE WHEN ${table.state} = 'RECOVERY_REQUIRED' THEN ${table.recoveryReason} IS NOT NULL AND trim(${table.recoveryReason}) <> '' WHEN ${table.state} IN ('READY', 'APPLYING') THEN ${table.recoveryReason} IS NULL ELSE 0 END`),
  })
);
