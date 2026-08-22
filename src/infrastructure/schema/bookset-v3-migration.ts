/**
 * BookSet V2->V3 migration.
 *
 * SQLite does not support dropping the v2 UNIQUE constraint in place.  The
 * rebuild therefore stages both sides of the account/book-set graph.  The
 * account staging table is important: dropping book_sets while accounts still
 * reference it is not valid with foreign_keys=ON, and rebuilding only
 * book_sets loses self-parented account graphs.
 */
export const BOOKSET_V3_MIGRATION_SQLITE = `
CREATE TABLE book_sets_v3 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('COMPANY', 'PERSONAL', 'PROPRIETORSHIP')),
  display_name TEXT NOT NULL CHECK (length(display_name) > 0 AND display_name = trim(display_name)),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_book_set_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE accounts_v3 (
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
  CONSTRAINT fk_account_book_set FOREIGN KEY (book_set_id) REFERENCES book_sets_v3(id),
  CONSTRAINT fk_account_parent FOREIGN KEY (parent_account_id) REFERENCES accounts_v3(id),
  CONSTRAINT uq_account_code_scope UNIQUE (tenant_id, book_set_id, code)
);

INSERT INTO book_sets_v3 (id, tenant_id, kind, display_name, lifecycle, created_at, updated_at)
SELECT id, tenant_id, kind,
  CASE kind
    WHEN 'COMPANY' THEN 'Company'
    WHEN 'PERSONAL' THEN 'Personal'
    WHEN 'PROPRIETORSHIP' THEN 'Proprietorship'
  END,
  lifecycle, created_at, updated_at
FROM book_sets;

INSERT INTO accounts_v3 (id, tenant_id, book_set_id, code, name, account_type, parent_account_id, archived_at, created_at, updated_at)
SELECT id, tenant_id, book_set_id, code, name, account_type, parent_account_id, archived_at, created_at, updated_at
FROM accounts;

DROP TRIGGER IF EXISTS tenants_default_book_set_tenant_match;
DROP TRIGGER IF EXISTS tenants_default_book_set_tenant_match_upd;
DROP TRIGGER IF EXISTS accounts_book_set_tenant_match;
DROP TRIGGER IF EXISTS accounts_book_set_tenant_match_upd;
DROP INDEX IF EXISTS idx_book_sets_tenant;
DROP INDEX IF EXISTS idx_accounts_tenant_book_set;

DROP TABLE accounts;
DROP TABLE book_sets;

ALTER TABLE book_sets_v3 RENAME TO book_sets;
ALTER TABLE accounts_v3 RENAME TO accounts;

CREATE INDEX idx_book_sets_tenant ON book_sets(tenant_id);
CREATE UNIQUE INDEX uq_book_set_tenant_company ON book_sets(tenant_id, kind) WHERE kind = 'COMPANY';
CREATE UNIQUE INDEX uq_book_set_tenant_personal ON book_sets(tenant_id, kind) WHERE kind = 'PERSONAL';
CREATE UNIQUE INDEX uq_book_set_tenant_display_name ON book_sets(tenant_id, display_name COLLATE NOCASE);
CREATE INDEX idx_accounts_tenant_book_set ON accounts(tenant_id, book_set_id);

CREATE TRIGGER tenants_default_book_set_tenant_match BEFORE INSERT ON tenants
WHEN NEW.default_book_set_id IS NOT NULL OR NEW.lifecycle = 'ACTIVE'
BEGIN
  SELECT CASE
    WHEN NEW.lifecycle = 'ACTIVE' AND NEW.default_book_set_id IS NULL
      THEN RAISE(ABORT, 'ACTIVE tenant requires an active default BookSet')
    WHEN NEW.default_book_set_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.default_book_set_id AND tenant_id = NEW.id AND lifecycle = 'ACTIVE'
    ) THEN RAISE(ABORT, 'default_book_set_id must belong to same tenant and be active')
  END;
END;

CREATE TRIGGER tenants_default_book_set_tenant_match_upd BEFORE UPDATE ON tenants
WHEN NEW.default_book_set_id IS NOT NULL OR NEW.lifecycle = 'ACTIVE'
BEGIN
  SELECT CASE
    WHEN NEW.lifecycle = 'ACTIVE' AND NEW.default_book_set_id IS NULL
      THEN RAISE(ABORT, 'ACTIVE tenant requires an active default BookSet')
    WHEN NEW.default_book_set_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM book_sets
      WHERE id = NEW.default_book_set_id AND tenant_id = NEW.id AND lifecycle = 'ACTIVE'
    ) THEN RAISE(ABORT, 'default_book_set_id must belong to same tenant and be active')
  END;
END;

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

CREATE TRIGGER book_sets_default_not_archived BEFORE UPDATE OF lifecycle ON book_sets
WHEN NEW.lifecycle = 'ARCHIVED'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM tenants WHERE default_book_set_id = NEW.id
  ) THEN RAISE(ABORT, 'current default BookSet cannot be archived') END;
END;

CREATE TRIGGER book_sets_default_not_deleted BEFORE DELETE ON book_sets
WHEN EXISTS (SELECT 1 FROM tenants WHERE default_book_set_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'current default BookSet cannot be deleted');
END;

CREATE TRIGGER book_sets_validate_existing_tenants BEFORE UPDATE ON tenants
WHEN (NEW.lifecycle = 'ACTIVE' AND NEW.default_book_set_id IS NULL)
  OR (NEW.default_book_set_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM book_sets bs
    WHERE bs.id = NEW.default_book_set_id AND bs.tenant_id = NEW.id AND bs.lifecycle = 'ACTIVE'
  ))
BEGIN
  SELECT RAISE(ABORT, 'existing tenant default must be same-tenant and active');
END;

UPDATE tenants SET id = id;
DROP TRIGGER book_sets_validate_existing_tenants;
`;

export const BOOKSET_V3_MIGRATION = {
  id: "0003-bookset-display-name",
  sqlite: BOOKSET_V3_MIGRATION_SQLITE,
  manifest: {
    version: 1,
    dialect: "sqlite" as const,
    retrySafe: true,
    probes: [
      {
        id: "v3-schema-exists",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'book_sets' AND sql LIKE '%display_name%' LIMIT 1",
        expectedRows: [{ table_count: "1" }],
      },
      {
        id: "v3-no-table-owned-kind-unique",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS constraint_count FROM sqlite_master WHERE type = 'table' AND name = 'book_sets' AND sql LIKE '%UNIQUE (tenant_id, kind)%' LIMIT 1",
        expectedRows: [{ constraint_count: "0" }],
      },
      {
        id: "v3-index-company-unique",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS index_count FROM pragma_index_list('book_sets') WHERE name = 'uq_book_set_tenant_company' AND " +
          "[unique] = 1 AND partial = 1 LIMIT 1",
        expectedRows: [{ index_count: "1" }],
      },
      {
        id: "v3-index-company-definition",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS definition_count FROM sqlite_master WHERE type = 'index' AND name = 'uq_book_set_tenant_company' AND sql LIKE '%ON book_sets(tenant_id, kind) WHERE kind = ''COMPANY''' LIMIT 1",
        expectedRows: [{ definition_count: "1" }],
      },
      {
        id: "v3-index-company-columns",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_index_info('uq_book_set_tenant_company') WHERE (seqno = 0 AND name = 'tenant_id') OR (seqno = 1 AND name = 'kind') LIMIT 2",
        expectedRows: [{ column_count: "2" }],
      },
      {
        id: "v3-index-personal-unique",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS index_count FROM pragma_index_list('book_sets') WHERE name = 'uq_book_set_tenant_personal' AND " +
          "[unique] = 1 AND partial = 1 LIMIT 1",
        expectedRows: [{ index_count: "1" }],
      },
      {
        id: "v3-index-personal-definition",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS definition_count FROM sqlite_master WHERE type = 'index' AND name = 'uq_book_set_tenant_personal' AND sql LIKE '%ON book_sets(tenant_id, kind) WHERE kind = ''PERSONAL''' LIMIT 1",
        expectedRows: [{ definition_count: "1" }],
      },
      {
        id: "v3-index-personal-columns",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS column_count FROM pragma_index_info('uq_book_set_tenant_personal') WHERE (seqno = 0 AND name = 'tenant_id') OR (seqno = 1 AND name = 'kind') LIMIT 2",
        expectedRows: [{ column_count: "2" }],
      },
      {
        id: "v3-index-display-name-nocase",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS index_count FROM pragma_index_list('book_sets') WHERE name = 'uq_book_set_tenant_display_name' AND [unique] = 1 AND partial = 0 LIMIT 1",
        expectedRows: [{ index_count: "1" }],
      },
      {
        id: "v3-foreign-keys",
        sql: "SELECT CAST(COUNT(*) AS TEXT) AS violation_count FROM pragma_foreign_key_check LIMIT 1",
        expectedRows: [{ violation_count: "0" }],
      },
    ],
  },
};
