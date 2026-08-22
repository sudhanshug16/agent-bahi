/**
 * BookSet V3->V4 migration.
 *
 * The columns that existed before 0004 are deliberately copied one-for-one.
 * They are a historical record format, not the command contract: legacy
 * action/actor values must remain readable even when they do not satisfy a
 * later command vocabulary. Structured command fields are nullable so that a
 * legacy row can be represented without inventing data.
 */
export const BOOKSET_V4_MIGRATION_SQLITE = `
-- A v4 audit record retains every legacy column and appends structured fields.
-- Do not add validation, defaults, or normalization to the legacy projection.
CREATE TABLE audit_records_v4 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  occurred_at TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  correlation_id TEXT,
  change_summary TEXT,
  evidence_ids TEXT,
  created_at TEXT NOT NULL,
  legacy_entity_type TEXT,
  legacy_entity_id TEXT,
  book_set_id TEXT,
  command TEXT,
  source TEXT,
  reason TEXT,
  canonical_before_hash TEXT,
  canonical_after_hash TEXT,
  committed_at TEXT,
  record_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_audit_book_set_tenant FOREIGN KEY (book_set_id, tenant_id) REFERENCES book_sets(id, tenant_id)
);

-- Make the parent key explicit before declaring the tenant-aware child FK.
CREATE UNIQUE INDEX uq_book_sets_id_tenant_v4 ON book_sets(id, tenant_id);

-- The SELECT is intentionally a direct projection. IS comparisons below are
-- SQLite's null-safe equality and preserve exact TEXT/BLOB bytes and NULLs.
INSERT INTO audit_records_v4
  (id, tenant_id, occurred_at, actor_type, actor_id, action, entity_type, entity_id,
   before_json, after_json, request_id, correlation_id, change_summary, evidence_ids,
   created_at, legacy_entity_type, legacy_entity_id, book_set_id, command, source, reason, canonical_before_hash,
   canonical_after_hash, committed_at, record_version)
SELECT
  id, tenant_id, NULL, actor_type, actor_id, action, entity_type, entity_id,
  NULL, NULL, request_id, NULL, change_summary, evidence_ids,
  created_at, entity_type, entity_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1
FROM audit_records;

CREATE TABLE audit_records_v4_validation (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO audit_records_v4_validation (valid)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM audit_records_v4) = (SELECT COUNT(*) FROM audit_records)
  AND NOT EXISTS (
    SELECT 1
    FROM audit_records old
    LEFT JOIN audit_records_v4 new ON new.id IS old.id
    WHERE new.id IS NULL
       OR NOT (new.id IS old.id)
       OR NOT (new.tenant_id IS old.tenant_id)
       OR NOT (new.actor_type IS old.actor_type)
       OR NOT (new.actor_id IS old.actor_id)
       OR NOT (new.action IS old.action)
       OR NOT (new.entity_type IS old.entity_type)
       OR NOT (new.entity_id IS old.entity_id)
       OR NOT (new.request_id IS old.request_id)
       OR NOT (new.change_summary IS old.change_summary)
       OR NOT (new.evidence_ids IS old.evidence_ids)
       OR NOT (new.created_at IS old.created_at)
  )
THEN 1 ELSE 0 END;

DROP TABLE audit_records_v4_validation;

DROP TABLE audit_records;
ALTER TABLE audit_records_v4 RENAME TO audit_records;

CREATE INDEX idx_audit_records_tenant ON audit_records(tenant_id);
CREATE INDEX idx_audit_records_request_id ON audit_records(request_id);
CREATE INDEX idx_audit_records_book_set ON audit_records(book_set_id);

-- Audit and finalized idempotency records are append-only after promotion.
CREATE TRIGGER audit_records_no_update BEFORE UPDATE ON audit_records
BEGIN
  SELECT RAISE(ABORT, 'audit_records are immutable');
END;

CREATE TRIGGER audit_records_no_delete BEFORE DELETE ON audit_records
BEGIN
  SELECT RAISE(ABORT, 'audit_records are immutable');
END;

CREATE TRIGGER idempotency_records_no_update BEFORE UPDATE ON idempotency_records
BEGIN
  SELECT RAISE(ABORT, 'idempotency_records are immutable');
END;

CREATE TRIGGER idempotency_records_no_delete BEFORE DELETE ON idempotency_records
BEGIN
  SELECT RAISE(ABORT, 'idempotency_records are immutable');
END;

-- A reservation may be finalized exactly once. All reservation identity
-- columns remain immutable, and a finalized row cannot be edited again.
CREATE TRIGGER tenant_creation_requests_finalize_once BEFORE UPDATE ON tenant_creation_requests
WHEN NOT (
  OLD.tenant_id IS NULL AND OLD.result_json IS NULL AND OLD.result_hash IS NULL
  AND NEW.tenant_id IS NOT NULL AND NEW.result_json IS NOT NULL AND NEW.result_hash IS NOT NULL
  AND NEW.id IS OLD.id
  AND NEW.request_id IS OLD.request_id
  AND NEW.request_hash IS OLD.request_hash
  AND NEW.created_at IS OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'tenant_creation_requests finalization is immutable');
END;

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
        id: "v4-audit-records-legacy-columns",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_table_info('audit_records') WHERE name IN ('id','tenant_id','occurred_at','actor_type','actor_id','action','entity_type','entity_id','before_json','after_json','request_id','correlation_id','change_summary','evidence_ids') LIMIT 14",
        expectedRows: [{ column_count: "14" }],
      },
      {
        id: "v4-audit-records-structured-columns",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_table_info('audit_records') WHERE name IN ('book_set_id','command','source','reason','canonical_before_hash','canonical_after_hash','committed_at','record_version','legacy_entity_type','legacy_entity_id') LIMIT 10",
        expectedRows: [{ column_count: "10" }],
      },
      {
        id: "v4-audit-records-composite-binding",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS fk_count FROM pragma_foreign_key_list('audit_records') WHERE [table] = 'book_sets' AND ([from] = 'book_set_id' OR [from] = 'tenant_id') LIMIT 2",
        expectedRows: [{ fk_count: "2" }],
      },
      {
        id: "v4-book-set-candidate-key",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS index_count FROM pragma_index_list('book_sets') WHERE name = 'uq_book_sets_id_tenant_v4' AND [unique] = 1 LIMIT 1",
        expectedRows: [{ index_count: "1" }],
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
        id: "v4-tenant-finalization-guard",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS trigger_count FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'tenant_creation_requests' AND name = 'tenant_creation_requests_finalize_once' LIMIT 1",
        expectedRows: [{ trigger_count: "1" }],
      },
      {
        id: "v4-tenant-delete-guard",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS trigger_count FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'tenant_creation_requests' AND name = 'tenant_creation_requests_no_delete' LIMIT 1",
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
