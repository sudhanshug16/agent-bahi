/**
 * BookSet V3->V4 migration.
 *
 * Adds command/audit integrity with structured audit fields, idempotency immutability,
 * and BookSet binding for mutation commands. Preserves all existing audit/idempotency data
 * with deterministic legacy backfill for new structured fields. Losslessly preserves all
 * original v2 columns (entity_type, entity_id) in legacy_entity column for historical audit.
 */
export const BOOKSET_V4_MIGRATION_SQLITE = `
-- Stage: Create new audit_records table with structured command fields
-- Preserves all original v2 columns by storing legacy entity data
CREATE TABLE audit_records_v4 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT,
  command TEXT NOT NULL CHECK (command IN ('bookset.create', 'bookset.set-default', 'bookset.archive', 'tenant.activate')),
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('HUMAN', 'AGENT', 'SYSTEM')),
  actor_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('CLI', 'MCP', 'INTERNAL', 'IMPORT')),
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL,
  canonical_before_hash TEXT,
  canonical_after_hash TEXT,
  change_summary TEXT,
  evidence_ids TEXT,
  legacy_entity_type TEXT,
  legacy_entity_id TEXT,
  committed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_audit_book_set FOREIGN KEY (book_set_id) REFERENCES book_sets(id)
);

-- Losslessly backfill audit_records_v4 from audit_records, preserving all v2 columns
INSERT INTO audit_records_v4
  (id, tenant_id, book_set_id, command, action, actor_type, actor_id, source, reason, request_id,
   canonical_before_hash, canonical_after_hash, change_summary, evidence_ids,
   legacy_entity_type, legacy_entity_id, committed_at, created_at)
SELECT
  id, tenant_id, NULL,
  COALESCE(action, 'unknown'),
  COALESCE(action, 'unknown'),
  COALESCE(actor_type, 'SYSTEM'),
  COALESCE(actor_id, 'legacy'),
  'INTERNAL',
  'legacy backfill',
  COALESCE(request_id, id),
  NULL,
  NULL,
  change_summary,
  evidence_ids,
  entity_type,
  entity_id,
  COALESCE(created_at, datetime('now')),
  COALESCE(created_at, datetime('now'))
FROM audit_records;

DROP TABLE IF EXISTS audit_records;
ALTER TABLE audit_records_v4 RENAME TO audit_records;

CREATE INDEX idx_audit_records_tenant ON audit_records(tenant_id);
CREATE INDEX idx_audit_records_request_id ON audit_records(request_id);
CREATE INDEX idx_audit_records_book_set ON audit_records(book_set_id);

-- Append-only guards on audit_records
CREATE TRIGGER audit_records_no_update BEFORE UPDATE ON audit_records
BEGIN
  SELECT RAISE(ABORT, 'audit_records are immutable');
END;

CREATE TRIGGER audit_records_no_delete BEFORE DELETE ON audit_records
BEGIN
  SELECT RAISE(ABORT, 'audit_records are immutable');
END;

-- Stage: Ensure idempotency_records are immutable
CREATE TRIGGER idempotency_records_no_update BEFORE UPDATE ON idempotency_records
BEGIN
  SELECT RAISE(ABORT, 'idempotency_records are immutable');
END;

CREATE TRIGGER idempotency_records_no_delete BEFORE DELETE ON idempotency_records
BEGIN
  SELECT RAISE(ABORT, 'idempotency_records are immutable');
END;

-- Ensure tenant_creation_requests remain immutable once finalized
CREATE TRIGGER tenant_creation_requests_no_delete BEFORE DELETE ON tenant_creation_requests
BEGIN
  SELECT RAISE(ABORT, 'tenant_creation_requests cannot be deleted');
END;
`;

export const BOOKSET_V4_MIGRATION = {
  id: "0004-bookset-command-audit",
  sqlite: BOOKSET_V4_MIGRATION_SQLITE,
  manifest: {
    version: 1,
    dialect: "sqlite" as const,
    retrySafe: true,
    probes: [
      {
        id: "v4-audit-records-exists",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'audit_records' LIMIT 1",
        expectedRows: [{ table_count: "1" }],
      },
      {
        id: "v4-audit-records-has-command",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_table_info('audit_records') WHERE name = 'command' LIMIT 1",
        expectedRows: [{ column_count: "1" }],
      },
      {
        id: "v4-audit-records-has-source",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_table_info('audit_records') WHERE name = 'source' LIMIT 1",
        expectedRows: [{ column_count: "1" }],
      },
      {
        id: "v4-audit-records-has-reason",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_table_info('audit_records') WHERE name = 'reason' LIMIT 1",
        expectedRows: [{ column_count: "1" }],
      },
      {
        id: "v4-audit-records-has-book-set-id",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_table_info('audit_records') WHERE name = 'book_set_id' LIMIT 1",
        expectedRows: [{ column_count: "1" }],
      },
      {
        id: "v4-audit-records-has-legacy-entity-type",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_table_info('audit_records') WHERE name = 'legacy_entity_type' LIMIT 1",
        expectedRows: [{ column_count: "1" }],
      },
      {
        id: "v4-audit-records-has-legacy-entity-id",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_table_info('audit_records') WHERE name = 'legacy_entity_id' LIMIT 1",
        expectedRows: [{ column_count: "1" }],
      },
      {
        id: "v4-idempotency-records-immutable",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS trigger_count FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'idempotency_records' AND name = 'idempotency_records_no_update' LIMIT 1",
        expectedRows: [{ trigger_count: "1" }],
      },
      {
        id: "v4-audit-records-immutable",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS trigger_count FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_records' AND name = 'audit_records_no_update' LIMIT 1",
        expectedRows: [{ trigger_count: "1" }],
      },
      {
        id: "v4-foreign-keys",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS violation_count FROM pragma_foreign_key_check LIMIT 1",
        expectedRows: [{ violation_count: "0" }],
      },
    ],
  },
};
