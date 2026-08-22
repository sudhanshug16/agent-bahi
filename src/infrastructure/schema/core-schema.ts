/**
 * Core relational schema for Phase 1A production persistence foundation.
 *
 * Models:
 * - tenants: legal entities
 * - book_sets: accounting partitions (COMPANY, PERSONAL, PROPRIETORSHIP)
 * - accounts: chart of accounts
 * - legal_identities: individuals and companies (PAN/registration numbers)
 * - gst_registrations: tenant-scoped GST registrations
 * - evidence: content-addressed audit trail
 * - audit_records: immutable ledger events
 * - idempotency_records: request deduplication
 *
 * Invariants (enforced via constraints and application logic):
 * - One COMPANY BookSet per COMPANY tenant
 * - One PERSONAL BookSet per INDIVIDUAL tenant
 * - Multiple PROPRIETORSHIP BookSets allowed only for INDIVIDUAL tenant
 * - Tenant cannot be deleted or archived if default_book_set_id is active
 * - BookSet cannot be archived if it's the current default
 * - Account code scope: (tenant_id, book_set_id) unique + never reused
 * - Legal identity PAN fingerprint: global uniqueness
 * - GST registrations: tenant-scoped with effective date rules
 * - Audit records: append-only, no UPDATE/DELETE
 */

export const CORE_SCHEMA_SQLITE = `
-- Tenants: top-level legal entities
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('COMPANY', 'INDIVIDUAL')),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('CREATING', 'ACTIVE', 'ARCHIVED')),
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'INR',
  default_book_set_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Book sets: accounting partitions within tenant
CREATE TABLE book_sets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('COMPANY', 'PERSONAL', 'PROPRIETORSHIP')),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_book_set_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT uq_book_set_tenant_kind UNIQUE (tenant_id, kind)
);

-- Composite FK enforcement: tenant.default_book_set_id must belong to same tenant
-- Trigger on insert/update of tenants
CREATE TRIGGER tenants_default_book_set_tenant_match BEFORE INSERT ON tenants
WHEN NEW.default_book_set_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.default_book_set_id AND tenant_id = NEW.id
    ) THEN RAISE(ABORT, 'default_book_set_id must belong to same tenant')
  END;
END;

CREATE TRIGGER tenants_default_book_set_tenant_match_upd BEFORE UPDATE ON tenants
WHEN NEW.default_book_set_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.default_book_set_id AND tenant_id = NEW.id
    ) THEN RAISE(ABORT, 'default_book_set_id must belong to same tenant')
  END;
END;

-- Accounts: chart of accounts
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  book_set_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  parent_account_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_account_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_account_book_set FOREIGN KEY (book_set_id) REFERENCES book_sets(id),
  CONSTRAINT fk_account_parent FOREIGN KEY (parent_account_id) REFERENCES accounts(id),
  CONSTRAINT uq_account_code_scope UNIQUE (tenant_id, book_set_id, code)
);

-- Composite FK enforcement: account.book_set_id must belong to account's tenant_id
-- This is the critical cross-tenant isolation constraint
CREATE TRIGGER accounts_book_set_tenant_match BEFORE INSERT ON accounts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.book_set_id AND tenant_id = NEW.tenant_id
    ) THEN RAISE(ABORT, 'account book_set_id must belong to account tenant_id')
  END;
END;

CREATE TRIGGER accounts_book_set_tenant_match_upd BEFORE UPDATE ON accounts
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.book_set_id AND tenant_id = NEW.tenant_id
    ) THEN RAISE(ABORT, 'account book_set_id must belong to account tenant_id')
  END;
END;

-- Legal identities: normalized PAN/registration fingerprints
CREATE TABLE legal_identities (
  id TEXT PRIMARY KEY,
  identity_type TEXT NOT NULL CHECK (identity_type IN ('INDIVIDUAL_PAN', 'COMPANY_CIN')),
  fingerprint TEXT NOT NULL UNIQUE,
  fingerprint_key_id TEXT,
  last_four TEXT,
  redacted_display TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Tenant creation requests: race-safe idempotency for tenant bootstrap
CREATE TABLE tenant_creation_requests (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  tenant_id TEXT,
  result_json TEXT,
  result_hash TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_tcr_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- GST registrations: tenant-scoped, effective-dated (supports historical records)
-- No UNIQUE(tenant_id, gstin) - allows multiple records for different effective date ranges
CREATE TABLE gst_registrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  gstin TEXT NOT NULL,
  state TEXT,
  scheme TEXT,
  status TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  fingerprint TEXT,
  fingerprint_key_id TEXT,
  last_four TEXT,
  redacted_display TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_gst_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Constraint: No overlapping effective date ranges for same GSTIN within tenant
-- This allows historical records but prevents invalid overlaps
CREATE TRIGGER gst_registrations_no_overlap BEFORE INSERT ON gst_registrations
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM gst_registrations gs
      WHERE gs.tenant_id = NEW.tenant_id
        AND gs.gstin = NEW.gstin
        AND gs.id != NEW.id
        AND gs.effective_from <= COALESCE(NEW.effective_to, '9999-12-31')
        AND COALESCE(gs.effective_to, '9999-12-31') >= NEW.effective_from
    ) THEN RAISE(ABORT, 'overlapping GST registration effective date ranges')
  END;
END;

CREATE TRIGGER gst_registrations_no_overlap_upd BEFORE UPDATE ON gst_registrations
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM gst_registrations gs
      WHERE gs.tenant_id = NEW.tenant_id
        AND gs.gstin = NEW.gstin
        AND gs.id != NEW.id
        AND gs.effective_from <= COALESCE(NEW.effective_to, '9999-12-31')
        AND COALESCE(gs.effective_to, '9999-12-31') >= NEW.effective_from
    ) THEN RAISE(ABORT, 'overlapping GST registration effective date ranges')
  END;
END;

-- Evidence: content-addressed audit artifacts
CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  storage_reference TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_evidence_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Audit records: append-only transaction log
CREATE TABLE audit_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  request_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  change_summary TEXT,
  evidence_ids TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Append-only guard: prevent UPDATE/DELETE on audit_records
CREATE TRIGGER audit_records_no_update BEFORE UPDATE ON audit_records
BEGIN
  SELECT RAISE(ABORT, 'audit_records are immutable');
END;

CREATE TRIGGER audit_records_no_delete BEFORE DELETE ON audit_records
BEGIN
  SELECT RAISE(ABORT, 'audit_records are immutable');
END;

-- Idempotency records: tenant-scoped request deduplication
CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_idempotency_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT uq_idempotency_key UNIQUE (tenant_id, request_id)
);

-- Indices for common queries
CREATE INDEX idx_book_sets_tenant ON book_sets(tenant_id);
CREATE INDEX idx_accounts_tenant_book_set ON accounts(tenant_id, book_set_id);
CREATE INDEX idx_gst_registrations_tenant ON gst_registrations(tenant_id);
CREATE INDEX idx_evidence_tenant ON evidence(tenant_id);
CREATE INDEX idx_audit_records_tenant ON audit_records(tenant_id);
CREATE INDEX idx_audit_records_request_id ON audit_records(request_id);
`;

/**
 * Migration metadata for the core schema.
 * SQLite-only implementation for Phase 1A.
 */
export const CORE_MIGRATIONS = {
  id: "0001-core-schema",
  sqlite: CORE_SCHEMA_SQLITE,
};
